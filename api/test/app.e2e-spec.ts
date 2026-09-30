/**
 * End-to-end tests against a real PostgreSQL + pgvector database.
 * TEST_DATABASE_URL must point at a disposable database: tables are dropped and re-created.
 */
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const TEST_DB = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DB ? describe : describe.skip;

/** A 384-dim vector literal: mostly `base` on one axis, a little on another. */
function vec(axis: number, tilt = 0): string {
  const v = new Array(384).fill(0);
  v[axis] = 1;
  if (tilt) v[axis + 1] = tilt;
  return `[${v.join(',')}]`;
}

async function seed(client: Client): Promise<void> {
  await client.query(
    'DROP TABLE IF EXISTS headline_edits, comment_actions, comments, story_votes, story_feedback, pipeline_runs, story_redirects, ' +
      'story_analyses, articles, stories, outlets CASCADE',
  );
  await client.query(readFileSync(join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8'));
  await client.query(`
    INSERT INTO outlets (id, slug, name, language, media_group) VALUES
      (1, 'alpha', 'Alpha News', 'en', 'Alpha Group'), (2, 'beta', 'Beta Times', 'en', NULL),
      (3, 'gamma', 'Gamma Samachar', 'hi', 'Alpha Group'), (4, 'delta', 'Delta Khabar', 'hi', NULL),
      (5, 'epsilon', 'Epsilon Patrika', 'hi', NULL), (6, 'zeta', 'Zeta Old', 'en', NULL);
    UPDATE outlets SET active = FALSE WHERE slug = 'zeta';
    UPDATE outlets SET country = 'IR', ownership = 'state' WHERE slug = 'beta';`);
  // Story 10: cross-language, analysed. Story 11: Hindi-only blindspot. Story 12: close to 10.
  await client.query(
    `INSERT INTO stories (id, centroid, article_count, outlet_count, languages, first_seen_at, last_article_at)
     VALUES (10, $1, 3, 3, '{en,hi}', now() - interval '5 hours', now() - interval '1 hour'),
            (11, $2, 3, 3, '{hi}', now() - interval '4 hours', now() - interval '2 hours'),
            (12, $3, 2, 2, '{en}', now() - interval '3 hours', now() - interval '3 hours')`,
    [vec(0), vec(5), vec(0, 0.3)],
  );
  await client.query(`
    INSERT INTO articles (outlet_id, story_id, url, url_hash, title, language, published_at) VALUES
      (1, 10, 'https://a.example/1', 'h1', 'Parliament passes data bill after long debate', 'en', now() - interval '5 hours'),
      (2, 10, 'https://b.example/1', 'h2', 'Data bill cleared amid opposition walkout', 'en', now() - interval '2 hours'),
      (3, 10, 'https://g.example/1', 'h3', 'संसद ने डेटा विधेयक पारित किया', 'hi', now() - interval '1 hour'),
      (3, 11, 'https://g.example/2', 'h4', 'बारिश से गांवों में बाढ़', 'hi', now() - interval '4 hours'),
      (4, 11, 'https://d.example/2', 'h5', 'गांवों में बाढ़, सड़कें बंद', 'hi', now() - interval '3 hours'),
      (5, 11, 'https://e.example/2', 'h6', 'बाढ़ से फसलें बर्बाद', 'hi', now() - interval '2 hours'),
      (1, 12, 'https://a.example/3', 'h7', 'Data bill: what changes for users', 'en', now() - interval '3 hours'),
      (2, 12, 'https://b.example/3', 'h8', '50% of firms unready for data bill', 'en', now() - interval '3 hours');`);
  await client.query(
    `INSERT INTO story_analyses (story_id, model, content, input_tokens, output_tokens) VALUES (10, 'test-model', $1, 900, 600)`,
    [
      JSON.stringify({
        same_event: true,
        facts_disputed: false,
        neutral_headline: { en: 'Parliament passes data protection bill', hi: 'संसद ने डेटा संरक्षण विधेयक पारित किया' },
        summary: { en: 'The bill passed.', hi: 'विधेयक पारित हुआ।' },
        common_ground: [{ en: 'The bill passed.', hi: 'विधेयक पारित हुआ।' }],
        differences: [{ en: 'Beta leads with the walkout.', hi: 'बीटा वॉकआउट को प्रमुखता देता है।' }],
        outlet_framing: [
          { outlet: 'beta', en: 'Leads with the walkout.', hi: 'वॉकआउट पर ज़ोर।' },
          { outlet: 'not-in-story', en: 'x', hi: 'y' },
        ],
        claims: [
          { claim: { en: 'The vote was 250-180.', hi: 'मतदान 250-180 रहा।' }, claimed_by: { en: 'Parliament', hi: 'संसद' },
            outlets: ['alpha', 'beta'], status: 'confirmed' },
          { claim: { en: 'Nobody', hi: 'कोई नहीं' }, claimed_by: { en: 'x', hi: 'y' }, outlets: ['ghost'], status: 'disputed' },
        ],
        debate: {
          question: { en: 'Should the bill exempt state agencies?', hi: 'क्या विधेयक में सरकारी एजेंसियों को छूट मिलनी चाहिए?' },
          for: [{ en: 'Alpha reports the government says it aids security.', hi: 'सरकार का कहना...', outlets: ['alpha'] }],
          against: [
            { en: 'Beta reports the opposition calls it a privacy risk.', hi: 'विपक्ष का कहना...', outlets: ['beta', 'gamma'] },
          ],
        },
      }),
    ],
  );
  await client.query(`
    INSERT INTO story_redirects (from_id, to_id) VALUES (99, 10);
    UPDATE articles SET image_url = 'https://img.example/data-bill.jpg' WHERE url = 'https://b.example/1';
    UPDATE stories SET category = 'sports' WHERE id = 11;
    INSERT INTO headline_edits (article_id, old_title, new_title)
      SELECT id, 'Data bill passed', title FROM articles WHERE url = 'https://b.example/1';
    INSERT INTO pipeline_runs (finished_at, feeds_ok, feeds_failed, articles_new, analyses, input_tokens, output_tokens)
    VALUES (now(), 22, 1, 40, 2, 2000, 1000);`);
}

describeDb('Nazariya API (e2e)', () => {
  let app: NestExpressApplication;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;

  beforeAll(async () => {
    const client = new Client({ connectionString: TEST_DB });
    await client.connect();
    await seed(client);
    await client.end();

    process.env.DATABASE_URL = TEST_DB;
    process.env.ADMIN_TOKEN = 'test-admin-token-1234567890';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health answers without the database', async () => {
    const res = await request(server).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    await request(server).get('/api/health/db').expect(200);
  });

  it('GET /api/stories ranks multi-outlet stories and mixes languages in sample headlines', async () => {
    const res = await request(server).get('/api/stories').expect(200);
    expect(res.headers['cache-control']).toContain('max-age=60');
    const ids = res.body.items.map((s: { id: number }) => s.id);
    expect(ids).toEqual([10, 11, 12]);
    const top = res.body.items[0];
    expect(top.headline.en).toBe('Parliament passes data protection bill');
    expect(top.coverage).toEqual({ en: 2, hi: 1, other: 0 });
    expect(top.analyzed).toBe(true);
    expect(top.debate.forCount).toBe(1);
    expect(res.body.items[1].debate).toBeNull();
    expect(top.leadHeadline.outlet.slug).toBe('gamma');
    expect(new Set(top.sampleHeadlines.map((h: { language: string }) => h.language))).toEqual(new Set(['en', 'hi']));
    expect(top.outlets.map((o: { slug: string }) => o.slug)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('keeps stories the AI flagged as mixed out of the list', async () => {
    const client = new Client({ connectionString: TEST_DB });
    await client.connect();
    await client.query(
      `INSERT INTO story_analyses (story_id, model, content) VALUES (11, 'm', '{"same_event": false}')`,
    );
    const res = await request(server).get('/api/stories?v=mixed').expect(200);
    expect(res.body.items.map((s: { id: number }) => s.id)).not.toContain(11);
    await request(server).get('/api/stories/11').expect(200); // still reachable by link
    await client.query(`DELETE FROM story_analyses WHERE story_id = 11`);
    await client.end();
  });

  it('filters by topic', async () => {
    const res = await request(server).get('/api/stories?category=sports&v=cat').expect(200);
    expect(res.body.items.map((s: { id: number }) => s.id)).toEqual([11]);
    expect(res.body.items[0].category).toBe('sports');
    await request(server).get('/api/stories?category=gossip').expect(400);
  });

  it('filters to stories covered in both languages', async () => {
    const res = await request(server).get('/api/stories?filter=both-languages').expect(200);
    expect(res.body.items.map((s: { id: number }) => s.id)).toEqual([10]);
  });

  it('rejects invalid query parameters', async () => {
    await request(server).get('/api/stories?limit=500').expect(400);
    await request(server).get('/api/stories?filter=left').expect(400);
    await request(server).get('/api/stories/search?q=a').expect(400);
  });

  it('GET /api/stories/:id returns the analysis, articles and timeline', async () => {
    const res = await request(server).get('/api/stories/10').expect(200);
    const story = res.body;
    expect(story.articles).toHaveLength(3);
    expect(story.analysis.framing).toHaveLength(1); // the unknown outlet slug is dropped
    expect(story.analysis.framing[0].outlet.name).toBe('Beta Times');
    expect(story.analysis.model).toBe('test-model');
    expect(story.analysis.debate.question.en).toMatch(/^Should/);
    expect(story.analysis.claims).toHaveLength(1); // the claim carried by no outlet in the story is dropped
    expect(story.analysis.claims[0].outlets.find((o: { slug: string }) => o.slug === 'beta'))
      .toMatchObject({ country: 'IR', ownership: 'state' });
    expect(story.analysis.debate.against[0].outlets.map((o: { slug: string }) => o.slug)).toEqual(['beta', 'gamma']);
    expect(story.debate).toEqual({ question: story.analysis.debate.question, forCount: 1, againstCount: 1 });
    expect(story.timeline.reduce((n: number, t: { en: number; hi: number }) => n + t.en + t.hi, 0)).toBe(3);
    expect(story.outlets.find((o: { slug: string }) => o.slug === 'gamma').mediaGroup).toBe('Alpha Group');
    expect(story.image).toEqual({ url: 'https://img.example/data-bill.jpg', outlet: 'Beta Times', articleUrl: 'https://b.example/1' });
    expect(story.headlineEdited).toBe(true);
    expect(story.headlineEdits[0]).toMatchObject({ oldTitle: 'Data bill passed', outlet: { slug: 'beta' } });
    expect(story.firstReports.map((f: { language: string }) => f.language)).toEqual(['en', 'hi']);
    expect(story.firstReports[0].outlet.slug).toBe('alpha');
  });

  it('follows redirects for merged stories and 404s for unknown ones', async () => {
    const res = await request(server).get('/api/stories/99').expect(200);
    expect(res.body.id).toBe(10);
    expect(res.body.requestedId).toBe(99);
    await request(server).get('/api/stories/12345').expect(404);
    await request(server).get('/api/stories/abc').expect(400);
  });

  it('GET /api/stories/:id/related uses vector similarity', async () => {
    const res = await request(server).get('/api/stories/10/related').expect(200);
    expect(res.body[0].story.id).toBe(12);
    expect(res.body[0].similarity).toBeGreaterThan(0.9);
    expect(res.body.map((r: { story: { id: number } }) => r.story.id)).not.toContain(11); // orthogonal
  });

  it('GET /api/stories/blindspots finds single-language stories', async () => {
    const res = await request(server).get('/api/stories/blindspots').expect(200);
    expect(res.body.onlyHindi.map((s: { id: number }) => s.id)).toEqual([11]);
    expect(res.body.onlyEnglish).toEqual([]); // story 12 has only 2 outlets
  });

  it('GET /api/stories/search matches English, Hindi and literal % signs', async () => {
    const en = await request(server).get('/api/stories/search?q=walkout').expect(200);
    expect(en.body.map((s: { id: number }) => s.id)).toEqual([10]);
    const hi = await request(server).get(`/api/stories/search?q=${encodeURIComponent('बाढ़')}`).expect(200);
    expect(hi.body.map((s: { id: number }) => s.id)).toEqual([11]);
    const pct = await request(server).get(`/api/stories/search?q=${encodeURIComponent('50%')}`).expect(200);
    expect(pct.body.map((s: { id: number }) => s.id)).toEqual([12]);
  });

  it('GET /api/outlets lists active outlets only', async () => {
    const res = await request(server).get('/api/outlets').expect(200);
    expect(res.body.map((o: { slug: string }) => o.slug)).not.toContain('zeta');
    expect(res.body.find((o: { slug: string }) => o.slug === 'gamma').articles24h).toBe(2);
  });

  it('GET /api/stats reports counts and AI cost', async () => {
    const res = await request(server).get('/api/stats').expect(200);
    expect(res.body.outlets).toEqual({ total: 5, en: 2, hi: 3, other: 0, countries: 2, languages: 2 });
    expect(res.body.headlineEdits24h).toBe(1);
    expect(res.body.crossLanguageStories).toBe(1);
    expect(res.body.lastRun.feedsOk).toBe(22);
    // 2000 input tokens at $1/M + 1000 output tokens at $5/M = $0.007
    expect(res.body.ai.estimatedCost24hUsd).toBeCloseTo(0.007, 5);
    expect(res.body.ai.averageCostPerAnalysisUsd).toBeCloseTo(0.0035, 5);
  });

  describe('readers', () => {
    const alice = { 'X-Visitor-Id': 'alice-0000-0000' };
    const bob = { 'X-Visitor-Id': 'bob-00000-0000' };
    const carol = { 'X-Visitor-Id': 'carol-0000-0000' };
    const admin = { 'X-Admin-Token': 'test-admin-token-1234567890' };

    it('posts and lists comments, and rejects links, bots and anonymous writes', async () => {
      const posted = await request(server).post('/api/stories/10/comments').set(alice)
        .send({ name: 'Asha', body: '  Both sides   made fair points.\n\n\n\nInteresting.  ' }).expect(201);
      expect(posted.body.body).toBe('Both sides   made fair points.\n\nInteresting.');
      await request(server).post('/api/stories/10/comments').set(bob).send({ body: 'Anonymous thought' }).expect(201);

      await request(server).post('/api/stories/10/comments').set(bob)
        .send({ body: 'I am a bot', website: 'http://bot' }).expect(201);   // accepted, silently dropped
      await request(server).post('/api/stories/10/comments').set(bob).send({ body: 'see www.spam.com' }).expect(400);
      await request(server).post('/api/stories/10/comments').send({ body: 'no visitor id' }).expect(400);
      // Over ten writes within a minute from one address: rate limited.
      for (let i = 0; i < 5; i++) await request(server).post('/api/stories/10/comments').set(bob).send({ body: 'x' });
      await request(server).post('/api/stories/10/comments').set(bob).send({ body: 'one too many' }).expect(429);
      await request(server).get('/api/stories/12345/comments').expect(404);

      const list = await request(server).get('/api/stories/10/comments').set(alice).expect(200);
      expect(list.body.map((c: { name: string }) => c.name)).toEqual(['Anonymous reader', 'Asha']);
      // Comments posted on a merged story's old id land on the surviving story.
      await request(server).get('/api/stories/99/comments').expect(200);
    });

    it('toggles upvotes and hides a comment after three reports', async () => {
      const [first] = (await request(server).get('/api/stories/10/comments?sort=new')).body;
      let res = await request(server).post(`/api/comments/${first.id}/upvote`).set(alice).expect(200);
      expect(res.body).toEqual({ upvotes: 1, upvotedByMe: true });
      res = await request(server).post(`/api/comments/${first.id}/upvote`).set(alice).expect(200);
      expect(res.body).toEqual({ upvotes: 0, upvotedByMe: false });

      for (const who of [alice, alice, bob]) await request(server).post(`/api/comments/${first.id}/report`).set(who).expect(200);
      let visible = (await request(server).get('/api/stories/10/comments')).body;
      expect(visible.map((c: { id: number }) => c.id)).toContain(first.id); // duplicate report didn't count
      await request(server).post(`/api/comments/${first.id}/report`).set(carol).expect(200);
      visible = (await request(server).get('/api/stories/10/comments')).body;
      expect(visible.map((c: { id: number }) => c.id)).not.toContain(first.id);

      // A moderator restores it; old reports are cleared.
      await request(server).get('/api/admin/queue').expect(403);
      await request(server).get('/api/admin/queue').set({ 'X-Admin-Token': 'wrong-token-000000000000' }).expect(403);
      const queue = await request(server).get('/api/admin/queue').set(admin).expect(200);
      expect(queue.body.comments[0]).toMatchObject({ id: first.id, hidden: true, reports: 3 });
      await request(server).post(`/api/admin/comments/${first.id}/restore`).set(admin).expect(204);
      visible = (await request(server).get('/api/stories/10/comments')).body;
      expect(visible.map((c: { id: number }) => c.id)).toContain(first.id);
      await request(server).delete(`/api/admin/comments/${first.id}`).set(admin).expect(204);
    });

    it('records one changeable vote per reader', async () => {
      await request(server).post('/api/stories/10/votes').set(alice).send({ side: 'for' }).expect(200);
      await request(server).post('/api/stories/10/votes').set(bob).send({ side: 'against' }).expect(200);
      const changed = await request(server).post('/api/stories/10/votes').set(alice).send({ side: 'unsure' }).expect(200);
      expect(changed.body).toEqual({ for: 0, against: 1, unsure: 1, mine: 'unsure' });
      await request(server).post('/api/stories/10/votes').set(alice).send({ side: 'maybe' }).expect(400);
      const anon = await request(server).get('/api/stories/10/votes').expect(200);
      expect(anon.body.mine).toBeNull();
    });

    it('accepts problem reports and shows them to moderators', async () => {
      await request(server).post('/api/stories/10/feedback').set(carol)
        .send({ kind: 'missing_side', note: 'The farmers’ view is missing.' }).expect(200);
      await request(server).post('/api/stories/10/feedback').set(carol).send({ kind: 'nonsense' }).expect(400);
      const queue = await request(server).get('/api/admin/queue').set(admin).expect(200);
      expect(queue.body.feedback[0]).toMatchObject({ storyId: 10, kind: 'missing_side',
        storyTitle: 'Parliament passes data protection bill' });
      await request(server).post(`/api/admin/feedback/${queue.body.feedback[0].id}/resolve`).set(admin).expect(204);
      expect((await request(server).get('/api/admin/queue').set(admin)).body.feedback).toEqual([]);
    });

    it('lists stories with counts, and filters world and debated stories', async () => {
      const client = new Client({ connectionString: TEST_DB });
      await client.connect();
      await client.query(`UPDATE stories SET section = 'world' WHERE id = 12`);
      await client.end();
      const world = await request(server).get('/api/stories?section=world&v=1').expect(200);
      expect(world.body.items.map((s: { id: number }) => s.id)).toEqual([12]);
      const debated = await request(server).get('/api/stories?debated=true&v=2').expect(200);
      expect(debated.body.items.map((s: { id: number }) => s.id)).toEqual([10]);
      const all = await request(server).get('/api/stories?v=3').expect(200);
      const top = all.body.items.find((s: { id: number }) => s.id === 10);
      expect(top.commentCount).toBe(1);
      expect(top.votes).toEqual({ for: 0, against: 1, unsure: 1 });
    });
  });
});
