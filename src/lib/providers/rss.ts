import Parser from "rss-parser";

const parser = new Parser();

export async function parseFeed(url: string) {
  return parser.parseURL(url);
}

