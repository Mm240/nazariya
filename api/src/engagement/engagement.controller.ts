import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AdminGuard } from './admin.guard';
import { CommentsQuery, FeedbackBody, NewCommentBody, VoteBody } from './engagement.dto';
import { EngagementService } from './engagement.service';
import { Visitor } from './visitor';

// Limits are per IP address, and a whole campus or office can share one, so they are generous;
// per-reader limits (one vote per story, 20 comments an hour) do the finer work.
const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('readers')
@ApiHeader({ name: 'X-Visitor-Id', description: 'Random id kept by the browser (8-64 letters, digits, dashes)' })
@Controller()
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Get('stories/:id/comments')
  @ApiOperation({ summary: 'Readers’ comments on a story' })
  comments(
    @Param('id', ParseIntPipe) id: number,
    @Query() q: CommentsQuery,
    @Visitor(false) visitor: string | null,
  ) {
    return this.engagement.comments(id, visitor, q.sort);
  }

  @Post('stories/:id/comments')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Post a comment (no links; 10 per minute per address, 20 per hour per reader)' })
  addComment(@Param('id', ParseIntPipe) id: number, @Body() body: NewCommentBody, @Visitor() visitor: string) {
    return this.engagement.addComment(id, visitor, body);
  }

  @Post('comments/:id/upvote')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Toggle your upvote on a comment' })
  upvote(@Param('id', ParseIntPipe) id: number, @Visitor() visitor: string) {
    return this.engagement.toggleUpvote(id, visitor);
  }

  @Post('comments/:id/report')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Report a comment; three reports hide it' })
  report(@Param('id', ParseIntPipe) id: number, @Visitor() visitor: string) {
    return this.engagement.report(id, visitor);
  }

  @Get('stories/:id/votes')
  @ApiOperation({ summary: 'Where readers stand on the story’s two-sides question' })
  votes(@Param('id', ParseIntPipe) id: number, @Visitor(false) visitor: string | null) {
    return this.engagement.votes(id, visitor);
  }

  @Post('stories/:id/votes')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Vote for, against or unsure (one vote per reader; can be changed)' })
  vote(@Param('id', ParseIntPipe) id: number, @Body() body: VoteBody, @Visitor() visitor: string) {
    return this.engagement.vote(id, visitor, body.side);
  }

  @Post('stories/:id/feedback')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({ summary: 'Report a problem with a story page' })
  feedback(@Param('id', ParseIntPipe) id: number, @Body() body: FeedbackBody, @Visitor() visitor: string) {
    return this.engagement.feedback(id, visitor, body);
  }
}

@ApiTags('moderation')
@ApiHeader({ name: 'X-Admin-Token', required: true })
@Controller('admin')
@UseGuards(AdminGuard)
@SkipThrottle()
export class AdminController {
  constructor(private readonly engagement: EngagementService) {}

  @Get('queue')
  @ApiOperation({ summary: 'Open problem reports and recent comments (hidden first)' })
  queue() {
    return this.engagement.moderationQueue();
  }

  @Post('comments/:id/hide')
  @HttpCode(204)
  hide(@Param('id', ParseIntPipe) id: number) {
    return this.engagement.setHidden(id, true);
  }

  @Post('comments/:id/restore')
  @HttpCode(204)
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.engagement.setHidden(id, false);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.engagement.deleteComment(id);
  }

  @Post('feedback/:id/resolve')
  @HttpCode(204)
  resolve(@Param('id', ParseIntPipe) id: number) {
    return this.engagement.resolveFeedback(id);
  }
}
