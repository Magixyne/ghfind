import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepository, nativePublicationHash } from "../repository";
import type { FeedActor, NativePostInput, PublicationEvidence, SocialFeedRepository, XPostInput } from "../contract";

const migration = readFileSync(new URL("../../../../migrations-feed/0016_social_posts.sql", import.meta.url), "utf8");
const alice: FeedActor = { user_id: "github:11", github_user_id: "11", github_login: "alice", name: "Alice", avatar_url: null };
const bob: FeedActor = { user_id: "github:22", github_user_id: "22", github_login: "bob", name: "Bob", avatar_url: null };
const carol: FeedActor = { user_id: "github:33", github_user_id: "33", github_login: "carol", name: "Carol", avatar_url: null };
const publication: PublicationEvidence = { score: 60, score_record_id: "score-11", score_version: "v11", policy_version: "social-feed-v1" };
const viewer = (actor: FeedActor) => ({ user_id: actor.user_id, can_reply: true });
function native(actor = alice, text = "Original post", parentPostId?: string): NativePostInput {
  return { actor, publication, input: { text }, idempotency_key: crypto.randomUUID(), parent_post_id: parentPostId };
}
function mirrored(): XPostInput {
  return { author: alice, publication, text: "X content", published_at: "2026-10-01T00:00:00.000Z", source: {
    post_id: "100001", author_id: "555", url: "https://x.com/alice_x/status/100001", display_name: "Alice on X", avatar_url: null,
    evidence_url: "https://x.com/alice_x", evidence_method: "editorial_review", evidence_checked_at: "2026-10-01T00:00:00.000Z",
  } };
}
let client: Client;
let repository: SocialFeedRepository;
beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.executeMultiple(migration);
  repository = createRepository(client);
});
afterEach(() => { client.close(); vi.useRealTimers(); });
async function count(table: string): Promise<number> {
  return Number((await client.execute(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count);
}

describe("social post storage", () => {
  it("keeps native and mirrored source identities separate, including replies to mirrors", async () => {
    const local = await repository.createNativePost(native());
    const mirror = await repository.ingestXPost(mirrored());
    const reply = await repository.createNativePost(native(bob, "A local reply", mirror.id));
    expect(local).toMatchObject({ origin: "ghfind", original_url: null, conversation_id: local.id, author: { github_login: "alice", name: "Alice" } });
    expect(mirror).toMatchObject({ origin: "x", original_url: "https://x.com/alice_x/status/100001", author: { github_login: "alice", name: "Alice on X" } });
    expect(reply).toMatchObject({ origin: "ghfind", original_url: null, conversation_id: mirror.id, parent_post_id: mirror.id });
    expect((await repository.getPost(local.id))?.viewer).toBeNull();
    await expect(repository.deleteNativePost(mirror.id, alice)).rejects.toMatchObject({ code: "not_post_author" });
  });
  it("atomically deduplicates concurrent creates, detects conflicting payloads, and replays after score loss", async () => {
    const command = native();
    const results = await Promise.all(Array.from({ length: 12 }, () => repository.createNativePost(command)));
    expect(new Set(results.map((post) => post.id)).size).toBe(1);
    expect(await count("social_feed_posts")).toBe(1);
    expect(await count("social_feed_events")).toBe(1);
    const replay = await repository.createNativePost({ ...command, publication: { ...publication, score: 0 } });
    expect(replay.id).toBe(results[0].id);
    await expect(repository.createNativePost({ ...command, input: { text: "different" } })).rejects.toMatchObject({ code: "idempotency_conflict" });
    const hash = await nativePublicationHash(command.input);
    expect(await repository.findPublication(bob.user_id, command.idempotency_key, hash)).toBeNull();
  });
  it("requires valid publication evidence and rejects client source fields", async () => {
    await expect(repository.createNativePost({ ...native(), publication: { ...publication, score: 59.96 } })).rejects.toMatchObject({ code: "score_below_threshold" });
    await expect(repository.createNativePost({ ...native(), input: { text: "spoof", origin: "x" } as never })).rejects.toMatchObject({ code: "invalid_post_fields" });
    expect(await count("social_feed_posts")).toBe(0);
  });
  it("preserves unlimited reply ancestry and deletion placeholders while rejecting replies to a deleted root", async () => {
    const root = await repository.createNativePost(native());
    const a = await repository.createNativePost(native(bob, "first", root.id));
    const b = await repository.createNativePost(native(alice, "second", a.id));
    const c = await repository.createNativePost(native(carol, "third", b.id));
    expect((await repository.listAncestors(c.id)).map((post) => post.id)).toEqual([root.id, a.id, b.id]);
    await repository.deleteNativePost(a.id, bob);
    expect((await repository.listAncestors(c.id))[1]).toMatchObject({ id: a.id, status: "deleted", text: "", media: [] });
    expect((await repository.listReplies(a.id)).items[0].id).toBe(b.id);
    await repository.deleteNativePost(root.id, alice);
    expect((await repository.getPost(c.id, viewer(carol)))?.viewer?.can_reply).toBe(false);
    await expect(repository.createNativePost(native(carol, "blocked", c.id))).rejects.toMatchObject({ code: "invalid_reply_target" });
    expect(await count("social_feed_posts")).toBe(4);
  });
  it("database guards prevent cross-conversation and immutable source edits", async () => {
    const root = await repository.createNativePost(native());
    const other = await repository.createNativePost(native(bob));
    await expect(client.execute({ sql: "UPDATE social_feed_posts SET conversation_id=? WHERE id=?", args: [other.id, root.id] })).rejects.toThrow("immutable_post_identity");
    await expect(client.execute({ sql: "UPDATE social_feed_posts SET origin='x' WHERE id=?", args: [root.id] })).rejects.toThrow("immutable_post_identity");
  });
  it("reaction changes are atomic, mutually exclusive, idempotent, and privacy scoped", async () => {
    const post = await repository.createNativePost(native());
    await Promise.all(Array.from({ length: 20 }, () => repository.setReaction(post.id, bob, "like")));
    expect((await repository.getPost(post.id))?.metrics.likes).toBe(1);
    await repository.setReaction(post.id, bob, "dislike");
    expect((await repository.getPost(post.id, viewer(bob)))?.viewer?.reaction).toBe("dislike");
    expect((await repository.getPost(post.id, viewer(alice)))?.viewer?.reaction).toBeNull();
    expect((await repository.getPost(post.id))?.metrics.likes).toBe(0);
    await repository.setReaction(post.id, bob, null);
    expect(await count("social_feed_reactions")).toBe(0);
    const events = await client.execute("SELECT COUNT(*) AS n FROM social_feed_events WHERE event_type='reaction_changed'");
    expect(Number(events.rows[0].n)).toBe(3);
  });
  it("bookmarks stay private and following delivers reposts with the original source", async () => {
    const mirror = await repository.ingestXPost(mirrored());
    await repository.setBookmark(mirror.id, bob, true);
    expect((await repository.getPost(mirror.id, viewer(alice)))?.viewer?.bookmarked).toBe(false);
    expect((await repository.listPosts({ channel: "bookmarks", viewer: viewer(bob) })).items.map((post) => post.id)).toEqual([mirror.id]);
    await expect(repository.listPosts({ channel: "bookmarks" })).rejects.toMatchObject({ code: "authentication_required" });
    await repository.upsertAuthor(bob);
    await repository.setFollow("gha_22", carol, true);
    await repository.setRepost(mirror.id, bob, true);
    const following = await repository.listPosts({ channel: "following", viewer: viewer(carol) });
    expect(following.items).toHaveLength(1);
    expect(following.items[0]).toMatchObject({ id: mirror.id, origin: "x", reposted_by: { github_login: "bob" }, original_url: mirror.original_url });
    await repository.setRepost(mirror.id, bob, false);
    expect((await repository.listPosts({ channel: "following", viewer: viewer(carol) })).items).toHaveLength(0);
  });
  it("views deduplicate actor/post/day and event retries, including concurrent delivery", async () => {
    const post = await repository.createNativePost(native());
    const date = new Date().toISOString().slice(0, 10);
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => repository.recordQualifiedView({ post_id: post.id, actor_key: "anonymous:one", event_id: `evt_${index}`, view_date: date })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await repository.getPost(post.id))?.metrics.views).toBe(1);
    await repository.recordQualifiedView({ post_id: post.id, actor_key: "anonymous:two", event_id: "evt_two", view_date: date });
    expect((await repository.getPost(post.id))?.metrics.views).toBe(2);
    await expect(repository.recordQualifiedView({ post_id: post.id, actor_key: "anonymous:three", event_id: "evt_three", view_date: "2000-01-01" })).rejects.toMatchObject({ code: "invalid_view" });
  });
  it("uses atomic quota limits under concurrent requests", async () => {
    const at = new Date("2026-10-26T00:00:00Z");
    const allowed = await Promise.all(Array.from({ length: 24 }, () => repository.consumeQuota(alice.user_id, "publish", at)));
    expect(allowed.filter(Boolean)).toHaveLength(10);
    expect(await repository.consumeQuota(alice.user_id, "publish", new Date(at.getTime() + 60_000))).toBe(true);
  });
  it("replays X versions to one local identity without losing interactions", async () => {
    const input = mirrored();
    const first = await repository.ingestXPost(input);
    await repository.setReaction(first.id, bob, "like");
    const edited = await repository.ingestXPost({ ...input, text: "Edited X content", source: { ...input.source, post_id: "100002", url: "https://x.com/alice_x/status/100002", edit_history_post_ids: ["100001", "100002"] } });
    expect(edited).toMatchObject({ id: first.id, content_version: 2, metrics: { likes: 1 } });
    expect(await count("social_feed_posts")).toBe(1);
    expect(await count("social_feed_x_versions")).toBe(2);
    const stale = await repository.ingestXPost(input);
    expect(stale).toMatchObject({ id: first.id, text: "Edited X content", content_version: 2, original_url: edited.original_url });
    expect(await count("social_feed_post_versions")).toBe(2);
    await expect(repository.ingestXPost({ ...input, author: bob })).rejects.toMatchObject({ code: "source_conflict" });
    await expect(repository.ingestXPost({ ...input, source: { ...input.source, url: "https://x.com/alice_x/status/999" } })).rejects.toMatchObject({ code: "invalid_x_source" });
  });
  it("persists one verified GitHub binding per X account and rejects cross-post impersonation", async () => {
    const first = mirrored();
    await repository.ingestXPost(first);
    await expect(repository.ingestXPost({ ...first, author: bob, source: { ...first.source, post_id: "100003", url: "https://x.com/alice_x/status/100003" } }))
      .rejects.toMatchObject({ code: "source_conflict" });
    expect(await count("social_feed_posts")).toBe(1);
    expect(await count("social_feed_x_accounts")).toBe(1);
    const row = (await client.execute("SELECT author_id,evidence_method FROM social_feed_x_accounts")).rows[0];
    expect(row).toMatchObject({ author_id: "gha_11", evidence_method: "editorial_review" });
  });
  it("never lets a concurrent old-version ingest replace a newer X edit", async () => {
    const first = mirrored();
    await repository.ingestXPost(first);
    const edited = { ...first, text: "Newer content", source: { ...first.source, post_id: "100002", url: "https://x.com/alice_x/status/100002", edit_history_post_ids: ["100001", "100002"] } };
    await Promise.all([repository.ingestXPost(edited), repository.ingestXPost(first), repository.ingestXPost(edited)]);
    const current = await repository.getPost("pst_x_100001");
    expect(current).toMatchObject({ text: "Newer content", content_version: 2 });
  });
  it("only imports X thread continuations by the same X account and GitHub author", async () => {
    const input = mirrored();
    const root = await repository.ingestXPost(input);
    const continuation = { ...input, parent_post_id: root.id, source: { ...input.source, post_id: "100003", url: "https://x.com/alice_x/status/100003" } };
    const child = await repository.ingestXPost(continuation);
    expect(child).toMatchObject({ origin: "x", kind: "reply", parent_post_id: root.id, conversation_id: root.id });
    const local = await repository.createNativePost(native());
    await expect(repository.ingestXPost({ ...continuation, parent_post_id: local.id, source: { ...input.source, post_id: "100004", url: "https://x.com/alice_x/status/100004" } }))
      .rejects.toMatchObject({ code: "invalid_reply_target" });
    await expect(repository.ingestXPost({ ...continuation, author: bob, source: { ...input.source, author_id: "777", post_id: "100005", url: "https://x.com/bob_x/status/100005" } }))
      .rejects.toMatchObject({ code: "invalid_reply_target" });
    await expect(repository.ingestXPost({ ...continuation, source: { ...input.source, author_id: "888", post_id: "100006", url: "https://x.com/alice_other/status/100006" } }))
      .rejects.toMatchObject({ code: "invalid_reply_target" });
    expect(await count("social_feed_posts")).toBe(3);
  });
  it("checks image ownership atomically and limits public asset access to live posts", async () => {
    await repository.registerMedia({ id: "img1", owner_user_id: alice.user_id, url: "/api/feed/media/img1", storage_key: "feed/img1", mime_type: "image/png", size_bytes: 120 });
    expect(await repository.canReadMedia("img1")).toBe(false);
    expect(await repository.canReadMedia("img1", alice.user_id)).toBe(true);
    await expect(repository.createNativePost({ ...native(bob), input: { text: "stolen", media_ids: ["img1"] } })).rejects.toMatchObject({ code: "invalid_media" });
    expect(await count("social_feed_posts")).toBe(0);
    const post = await repository.createNativePost({ ...native(), input: { text: "", media_ids: ["img1"] } });
    expect(post.media[0].id).toBe("img1");
    expect(await repository.canReadMedia("img1")).toBe(true);
    await repository.deleteNativePost(post.id, alice);
    expect(await repository.canReadMedia("img1")).toBe(false);
  });
  it("keyset pagination excludes newer arrivals and cannot cross user/channel scopes", async () => {
    for (let index = 0; index < 5; index++) await repository.createNativePost(native(alice, `Post ${index}`));
    const first = await repository.listPosts({ channel: "recommended", limit: 2 });
    const next = await repository.listPosts({ channel: "recommended", limit: 2, cursor: first.next_cursor! });
    expect(new Set([...first.items, ...next.items].map((post) => post.id)).size).toBe(4);
    await repository.createNativePost(native(alice, "After page one"));
    const last = await repository.listPosts({ channel: "recommended", limit: 2, cursor: next.next_cursor! });
    expect(last.items).toHaveLength(1);
    expect(last.next_cursor).toBeNull();
    await expect(repository.listPosts({ channel: "following", viewer: viewer(bob), cursor: first.next_cursor! })).rejects.toMatchObject({ code: "invalid_cursor" });
  });
  it("freezes timeline activities so an undone repost cannot replay its original on later pages", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    const old = await repository.createNativePost(native(alice, "Older original"));
    vi.setSystemTime(new Date("2026-10-02T00:00:00Z"));
    const newer = await repository.createNativePost(native(alice, "Newer original"));
    vi.setSystemTime(new Date("2026-10-03T00:00:00Z"));
    await repository.setRepost(old.id, bob, true);
    const first = await repository.listPosts({ channel: "recommended", limit: 1 });
    expect(first.items[0].id).toBe(old.id);
    await repository.setRepost(old.id, bob, false);
    const rest = await repository.listPosts({ channel: "recommended", cursor: first.next_cursor!, limit: 10 });
    expect(rest.items.map((post) => post.id)).toEqual([newer.id]);
    expect(rest.next_cursor).toBeNull();
  });
  it("keeps same-millisecond new posts out of an existing delivery snapshot", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
    for (let index = 0; index < 3; index++) await repository.createNativePost(native(alice, `Before ${index}`));
    const first = await repository.listPosts({ channel: "recommended", limit: 1 });
    const arrival = await repository.createNativePost(native(alice, "Same millisecond arrival"));
    const rest = await repository.listPosts({ channel: "recommended", cursor: first.next_cursor!, limit: 10 });
    expect(rest.items).toHaveLength(2);
    expect(rest.items.some((post) => post.id === arrival.id)).toBe(false);
  });
  it("rechecks live visibility and expires sessions while cleaning old snapshots in bounded batches", async () => {
    const posts = await Promise.all([repository.createNativePost(native(alice, "A")), repository.createNativePost(native(alice, "B")), repository.createNativePost(native(alice, "C"))]);
    const first = await repository.listPosts({ channel: "recommended", limit: 1 });
    const unseen = posts.filter((post) => post.id !== first.items[0].id);
    await repository.deleteNativePost(unseen[0].id, alice);
    const rest = await repository.listPosts({ channel: "recommended", cursor: first.next_cursor!, limit: 10 });
    expect(rest.items.map((post) => post.id)).toEqual([unseen[1].id]);
    await client.execute("UPDATE social_feed_sessions SET expires_at='2000-01-01T00:00:00.000Z'");
    await expect(repository.listPosts({ channel: "recommended", cursor: first.next_cursor! })).rejects.toMatchObject({ code: "cursor_expired" });
    await repository.listPosts({ channel: "recommended" });
    expect(await count("social_feed_sessions")).toBe(1);
    expect(await count("social_feed_session_items")).toBe(2);
  });

  it("hydrates deep ancestry in bounded database queries", async () => {
    let parent = await repository.createNativePost(native());
    for (let depth = 0; depth < 105; depth++) parent = await repository.createNativePost(native(alice, `depth ${depth}`, parent.id));
    const queries = vi.spyOn(client, "execute");
    const ancestors = await repository.listAncestors(parent.id);
    expect(ancestors).toHaveLength(105);
    for (const call of queries.mock.calls) {
      const statement: unknown = call[0];
      if (typeof statement === "object" && statement !== null && "args" in statement && Array.isArray(statement.args)) {
        expect(statement.args.length).toBeLessThanOrEqual(100);
      }
    }
    queries.mockRestore();
  });

});
