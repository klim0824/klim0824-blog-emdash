import * as cheerio from "cheerio";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const seedPath = path.join(__dirname, "../../seed/seed.json");

const ARTICLE_ORDER = [
  "macbook-air-m4",
  "summary2025",
  "summary2024",
  "summary2023",
  "summary2022",
  "20220806_yokosuka",
  "20220522_yokota",
  "reboot",
  "building-a-blog-with-nextjs-and-microcms",
];

let mediaMap = {};
try {
  mediaMap = JSON.parse(readFileSync(path.join(dataDir, "media-map.json"), "utf-8"));
} catch {
  // no media map yet: images fall back to hotlinked htmlBlocks
}

let keyCounter = 0;
function nextKey() {
  keyCounter += 1;
  return `k${keyCounter.toString(36)}`;
}

function span(text, marks = []) {
  const node = { _type: "span", _key: nextKey(), text };
  if (marks.length) node.marks = marks;
  return node;
}

function textBlock(children, markDefs, extra = {}) {
  const block = { _type: "block", _key: nextKey(), style: "normal", children, ...extra };
  if (markDefs && markDefs.length) block.markDefs = markDefs;
  return block;
}

function imageBlock(src, alt) {
  const entry = mediaMap[src];
  if (entry) {
    const block = { _type: "image", _key: nextKey(), asset: { _ref: entry.storageKey } };
    if (alt) block.alt = alt;
    return block;
  }
  return {
    _type: "htmlBlock",
    _key: nextKey(),
    html: `<img src="${src}" alt="${(alt || "").replace(/"/g, "&quot;")}">`,
  };
}

// Shape matching what EmDash stores for an `image`-type field value
// (posts.featured_image, tag_icons.icon), resolved from an already-uploaded
// media item rather than the seed's own $media downloader (which can't reach
// R2 when run standalone, outside the Workers runtime).
function imageFieldValue(src) {
  const entry = mediaMap[src];
  if (!entry) return null;
  return {
    provider: "local",
    id: entry.id,
    width: entry.width,
    height: entry.height,
    mimeType: entry.mimeType,
    filename: entry.filename,
    meta: { storageKey: entry.storageKey },
  };
}

// Walks the inline content of a single block-level element (p, h2, li, ...)
// into PortableText spans + markDefs. Drops inline styling (Q7); keeps
// semantic emphasis/links.
function parseInline($, el) {
  const children = [];
  const markDefs = [];

  function walk(node, marks) {
    if (node.type === "text") {
      if (node.data) children.push(span(node.data, marks));
      return;
    }
    if (node.type !== "tag") return;
    const tag = node.tagName || node.name;

    if (tag === "br") {
      children.push(span("\n", marks));
      return;
    }
    if (tag === "img") return; // images are pulled out as separate blocks
    if (tag === "a") {
      const href = $(node).attr("href") || "";
      const markDef = { _type: "link", _key: nextKey(), href };
      markDefs.push(markDef);
      const childMarks = [...marks, markDef._key];
      $(node)
        .contents()
        .each((_, child) => walk(child, childMarks));
      return;
    }
    const decorator = { em: "em", i: "em", strong: "strong", b: "strong", u: "underline", s: "strike-through", strike: "strike-through", del: "strike-through", code: "code" }[tag];
    if (decorator) {
      $(node)
        .contents()
        .each((_, child) => walk(child, [...marks, decorator]));
      return;
    }
    // unknown inline wrapper (span, etc.): unwrap and drop its styling
    $(node)
      .contents()
      .each((_, child) => walk(child, marks));
  }

  $(el)
    .contents()
    .each((_, child) => walk(child, []));

  return { children, markDefs };
}

function pushImagesIn($, el, blocks) {
  $(el)
    .find("img")
    .each((_, img) => {
      const src = $(img).attr("src");
      if (!src) return;
      blocks.push(imageBlock(src, $(img).attr("alt")));
    });
}

function walkList($, el, level, blocks) {
  const tag = el.tagName || el.name;
  const listItem = tag === "ol" ? "number" : "bullet";
  $(el)
    .children("li")
    .each((_, li) => {
      const $li = $(li);
      const directContent = $li.clone();
      directContent.find("ul, ol").remove();
      const hasText = directContent.text().replace(/ /g, " ").trim() !== "";
      if (hasText) {
        const { children, markDefs } = parseInline($, directContent.get(0));
        blocks.push({ _type: "block", _key: nextKey(), style: "normal", listItem, level, children, ...(markDefs.length ? { markDefs } : {}) });
      }
      pushImagesIn($, directContent, blocks);
      $li.children("ul, ol").each((_, nested) => walkList($, nested, level + 1, blocks));
    });
}

function convertTweet($, blockquoteEl, blocks) {
  const $bq = $(blockquoteEl);
  const tweetLink = $bq.find('a[href*="status/"]').last();
  const tweetUrl = (tweetLink.attr("href") || "").split("?")[0];
  const textEl = $bq.find("p").first().get(0) || blockquoteEl;
  const { children, markDefs } = parseInline($, textEl);
  if (tweetUrl) {
    const markDef = { _type: "link", _key: nextKey(), href: tweetUrl };
    markDefs.push(markDef);
    children.push(span(" (元のツイートを見る)", [markDef._key]));
  }
  blocks.push(textBlock(children, markDefs, { style: "blockquote" }));
}

function convertContent(html) {
  keyCounter = 0;
  const $ = cheerio.load(html || "", null, false);
  const blocks = [];
  const root = $.root();

  const HEADING_STYLE = { h2: "h2", h3: "h3", h4: "h4", h5: "h5", h6: "h6" };

  root.contents().each((_, el) => {
    if (el.type !== "tag") return;
    const tag = el.tagName || el.name;

    if (tag === "script") return;

    if (tag === "p") {
      const $p = $(el);
      const hasImg = $p.find("img").length > 0;
      const textOnly = $p.clone();
      textOnly.find("img").remove();
      const hasText = textOnly.text().replace(/ /g, " ").trim() !== "";
      if (hasText) {
        const { children, markDefs } = parseInline($, el);
        blocks.push(textBlock(children, markDefs));
      }
      if (hasImg) pushImagesIn($, $p, blocks);
      return;
    }

    if (HEADING_STYLE[tag]) {
      const $h = $(el);
      const hasImg = $h.find("img").length > 0;
      const textOnly = $h.clone();
      textOnly.find("img").remove();
      const hasText = textOnly.text().trim() !== "";
      if (hasText) {
        const { children, markDefs } = parseInline($, el);
        blocks.push(textBlock(children, markDefs, { style: HEADING_STYLE[tag] }));
      }
      if (hasImg) pushImagesIn($, $h, blocks);
      return;
    }

    if (tag === "ul" || tag === "ol") {
      walkList($, el, 1, blocks);
      return;
    }

    if (tag === "pre") {
      const codeEl = $(el).find("code").get(0) || el;
      blocks.push({ _type: "code", _key: nextKey(), code: $(codeEl).text() });
      return;
    }

    if (tag === "blockquote" && $(el).hasClass("twitter-tweet")) {
      convertTweet($, el, blocks);
      return;
    }

    if (tag === "img") {
      const src = $(el).attr("src");
      if (src) blocks.push(imageBlock(src, $(el).attr("alt")));
      return;
    }

    // fallback: anything else EmDash can't natively represent
    const outer = $.html(el);
    if (outer && outer.trim()) {
      blocks.push({ _type: "htmlBlock", _key: nextKey(), html: outer });
    }
  });

  return blocks;
}

function buildPost(article) {
  const data = {
    title: article.title,
    published_date: article.publishedAt,
    content: convertContent(article.content),
    excerpt: article.description || "",
  };
  if (article.mainvisual?.url) {
    const featuredImage = imageFieldValue(article.mainvisual.url);
    if (featuredImage) data.featured_image = featuredImage;
  }
  return {
    id: article.id,
    slug: article.id,
    status: "published",
    data,
    bylines: [{ byline: "klim0824" }],
    taxonomies: {
      category: article.category ? [article.category.id] : [],
      tag: (article.tags || []).map((t) => t.id),
    },
  };
}

const TAG_ICONS = [
  ["microcms", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/01079630bc9c4373909c76d062b10dca/microcms.png"],
  ["react", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/3468e65f9dba4fe2b104d3d20b211c45/react.svg"],
  ["nextjs", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/7ef5887e5ba04725a74c314143c6d309/nextjs.svg"],
  ["nodejs", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/101acfae25f343f68a2954b3851388b0/nodejs.svg"],
  ["typescript", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/046572aeb14c4596911bac98ae3f2a30/typescript.svg"],
  ["javascript", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/620d79bd12ae495ba0211b09846d636e/javascript.svg"],
  ["homebrew", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/0f5931e4ccd4451ea98b7a83df25a761/homebrew.png"],
  ["windows", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/56bc04dd4dc64da8940878814562ada0/windows.svg"],
  ["mac", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/5c275cee47284790812827a93526f23b/apple.svg"],
  ["sourcetree", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/f835c477b6774349bf0b68ee49cb51c3/sourcetree.svg"],
  ["git", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/9697c7c3d85f491aa190e07d6ee63cf8/git.svg"],
  ["tampermonkey", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/07d2c83cc7ae42bbab53ce125fc0580b/tampermonkey.svg"],
  ["virtualbox", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/420cd87f3202462e82c067a2a2d3e695/virtualbox.png"],
  ["vscode", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/e75bc64f20234a6b9a8163602ebdbabf/vscode.svg"],
  ["wordpress", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/f7c1adaa32104876a4d4e57442b70cdf/wordpress.svg"],
  ["web", "https://images.microcms-assets.io/assets/19c7ac584e514243829c7cf5e7420b27/ecd30ba28f0d4646ab84e8ed07870ced/web.svg"],
];

function buildTagIcons() {
  return TAG_ICONS.map(([slug, url]) => {
    const icon = imageFieldValue(url);
    return {
      id: slug,
      slug,
      status: "published",
      data: { tag_slug: slug, icon },
    };
  });
}

function main() {
  const available = new Set(readdirSync(dataDir).map((f) => f.replace(/\.json$/, "")));
  const missing = ARTICLE_ORDER.filter((id) => !available.has(id));
  if (missing.length) {
    console.error(`Missing fixture data for: ${missing.join(", ")}`);
    process.exit(1);
  }

  const posts = ARTICLE_ORDER.map((id) => {
    const article = JSON.parse(readFileSync(path.join(dataDir, `${id}.json`), "utf-8"));
    return buildPost(article);
  });

  const seed = JSON.parse(readFileSync(seedPath, "utf-8"));
  seed.content.posts = posts;
  seed.content.tag_icons = buildTagIcons();
  writeFileSync(seedPath, JSON.stringify(seed, null, "\t") + "\n", "utf-8");

  console.log(`Wrote ${posts.length} posts to seed/seed.json`);
}

main();
