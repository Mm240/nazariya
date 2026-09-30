import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { FeedbackBody, NewCommentBody, Side } from './engagement.dto';

export interface CommentView {
  id: number;
  name: string;
  body: string;
  upvotes: number;
  createdAt: string;
  upvotedByMe: boolean;
  reportedByMe: boolean;
}

export interface VoteSummary {
  for: number;
  against: number;
  unsure: number;
  mine: Side | null;
}

/** Comments with this many reports disappear until a moderator restores them. */
export const HIDE_AFTER_REPORTS = 3;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|net|org|io|co|ly|me|xyz)\b)/i;

@Injectable()
export class EngagementService {
  constructor(private readonly db: DatabaseService) {}

  /** Stories merged into others keep working, like the story pages themselves. */
  private async resolveStory(requestedId: number): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      `SELECT s.id FROM stories s
       WHERE s.id = coalesce((SELECT to_id FROM story_redirects WHERE from_id = $1), $1)`,
      [requestedId],
    );
    if (!rows.length) throw new NotFoundException(`Story ${requestedId} not found`);
    return rows[0].id;
  }

  async comments(storyId: number, visitor: string | null, sort: 'new' | 'top'): Promise<CommentView[]> {
    const id = await this.resolveStory(storyId);
    const order = sort === 'top' ? 'c.upvotes DESC, c.created_at DESC' : 'c.created_at DESC';
    return this.db.query<CommentView>(
      `SELECT c.id, c.name, c.body, c.upvotes, c.created_at AS "createdAt",
              EXISTS (SELECT 1 FROM comment_actions ca
                      WHERE ca.comment_id = c.id AND ca.visitor = $2 AND ca.action = 'upvote') AS "upvotedByMe",
              EXISTS (SELECT 1 FROM comment_actions ca
                      WHERE ca.comment_id = c.id AND ca.visitor = $2 AND ca.action = 'report') AS "reportedByMe"
       FROM comments c
       WHERE c.story_id = $1 AND NOT c.hidden
       ORDER BY ${order}
       LIMIT 200`,
      [id, visitor ?? ''],
    );
  }

  async addComment(storyId: number, visitor: string, input: NewCommentBody): Promise<CommentView | null> {
    const id = await this.resolveStory(storyId);
    if (input.website) return null; // honeypot tripped: pretend it worked, store nothing
    if (LINK.test(input.body) || (input.name && LINK.test(input.name))) {
      throw new BadRequestException('Links are not allowed in comments.');
    }
    const [{ recent }] = await this.db.query<{ recent: number }>(
      `SELECT count(*) AS recent FROM comments WHERE visitor = $1 AND created_at > now() - interval '1 hour'`,
      [visitor],
    );
    if (recent >= 20) throw new BadRequestException('You have posted a lot in the last hour. Try again later.');
    const [row] = await this.db.query<CommentView>(
      `INSERT INTO comments (story_id, visitor, name, body) VALUES ($1, $2, $3, $4)
       RETURNING id, name, body, upvotes, created_at AS "createdAt",
                 FALSE AS "upvotedByMe", FALSE AS "reportedByMe"`,
      [id, visitor, input.name?.trim() || 'Anonymous reader', input.body],
    );
    return row;
  }

  /** Toggles the reader's upvote; returns the new count. */
  async toggleUpvote(commentId: number, visitor: string): Promise<{ upvotes: number; upvotedByMe: boolean }> {
    await this.visibleComment(commentId);
    const removed = await this.db.query(
      `DELETE FROM comment_actions WHERE comment_id = $1 AND visitor = $2 AND action = 'upvote' RETURNING 1`,
      [commentId, visitor],
    );
    if (removed.length === 0) {
      await this.db.query(
        `INSERT INTO comment_actions (comment_id, visitor, action) VALUES ($1, $2, 'upvote') ON CONFLICT DO NOTHING`,
        [commentId, visitor],
      );
    }
    const [row] = await this.db.query<{ upvotes: number }>(
      `UPDATE comments SET upvotes = (SELECT count(*) FROM comment_actions
                                      WHERE comment_id = $1 AND action = 'upvote')
       WHERE id = $1 RETURNING upvotes`,
      [commentId],
    );
    return { upvotes: row.upvotes, upvotedByMe: removed.length === 0 };
  }

  async report(commentId: number, visitor: string): Promise<{ hidden: boolean }> {
    await this.visibleComment(commentId);
    await this.db.query(
      `INSERT INTO comment_actions (comment_id, visitor, action) VALUES ($1, $2, 'report') ON CONFLICT DO NOTHING`,
      [commentId, visitor],
    );
    const [row] = await this.db.query<{ hidden: boolean }>(
      `UPDATE comments SET
         reports = (SELECT count(*) FROM comment_actions WHERE comment_id = $1 AND action = 'report'),
         hidden = hidden OR (SELECT count(*) FROM comment_actions WHERE comment_id = $1 AND action = 'report') >= $2
       WHERE id = $1 RETURNING hidden`,
      [commentId, HIDE_AFTER_REPORTS],
    );
    return { hidden: row.hidden };
  }

  private async visibleComment(commentId: number): Promise<void> {
    const rows = await this.db.query(`SELECT 1 FROM comments WHERE id = $1 AND NOT hidden`, [commentId]);
    if (!rows.length) throw new NotFoundException('Comment not found');
  }

  async votes(storyId: number, visitor: string | null): Promise<VoteSummary> {
    const id = await this.resolveStory(storyId);
    const [row] = await this.db.query<VoteSummary>(
      `SELECT count(*) FILTER (WHERE side = 'for') AS "for",
              count(*) FILTER (WHERE side = 'against') AS against,
              count(*) FILTER (WHERE side = 'unsure') AS unsure,
              max(side) FILTER (WHERE visitor = $2) AS mine
       FROM story_votes WHERE story_id = $1`,
      [id, visitor ?? ''],
    );
    return row;
  }

  async vote(storyId: number, visitor: string, side: Side): Promise<VoteSummary> {
    const id = await this.resolveStory(storyId);
    await this.db.query(
      `INSERT INTO story_votes (story_id, visitor, side) VALUES ($1, $2, $3)
       ON CONFLICT (story_id, visitor) DO UPDATE SET side = EXCLUDED.side, created_at = now()`,
      [id, visitor, side],
    );
    return this.votes(id, visitor);
  }

  async feedback(storyId: number, visitor: string, input: FeedbackBody): Promise<{ received: true }> {
    const id = await this.resolveStory(storyId);
    const [{ n }] = await this.db.query<{ n: number }>(
      `SELECT count(*) AS n FROM story_feedback WHERE story_id = $1 AND visitor = $2`,
      [id, visitor],
    );
    if (n < 5) {
      await this.db.query(
        `INSERT INTO story_feedback (story_id, visitor, kind, note) VALUES ($1, $2, $3, $4)`,
        [id, visitor, input.kind, input.note || null],
      );
    }
    return { received: true };
  }

  // ---------- moderation ----------

  async moderationQueue() {
    const [feedback, comments] = await Promise.all([
      this.db.query(
        `SELECT f.id, f.story_id AS "storyId", f.kind, f.note, f.created_at AS "createdAt",
                coalesce(sa.content->'neutral_headline'->>'en',
                         (SELECT title FROM articles WHERE story_id = f.story_id ORDER BY published_at DESC LIMIT 1))
                  AS "storyTitle"
         FROM story_feedback f LEFT JOIN story_analyses sa ON sa.story_id = f.story_id
         WHERE NOT f.resolved ORDER BY f.created_at DESC LIMIT 200`,
      ),
      this.db.query(
        `SELECT id, story_id AS "storyId", name, body, upvotes, reports, hidden, created_at AS "createdAt"
         FROM comments ORDER BY hidden DESC, reports DESC, created_at DESC LIMIT 200`,
      ),
    ]);
    return { feedback, comments };
  }

  async setHidden(commentId: number, hidden: boolean): Promise<void> {
    // Restoring a comment also clears its reports, so it isn't hidden again by old reports.
    await this.db.query(
      `UPDATE comments SET hidden = $2, reports = CASE WHEN $2 THEN reports ELSE 0 END WHERE id = $1`,
      [commentId, hidden],
    );
    if (!hidden) await this.db.query(`DELETE FROM comment_actions WHERE comment_id = $1 AND action = 'report'`, [commentId]);
  }

  async deleteComment(commentId: number): Promise<void> {
    await this.db.query(`DELETE FROM comments WHERE id = $1`, [commentId]);
  }

  async resolveFeedback(feedbackId: number): Promise<void> {
    await this.db.query(`UPDATE story_feedback SET resolved = TRUE WHERE id = $1`, [feedbackId]);
  }
}
