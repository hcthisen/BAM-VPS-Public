export type OutlineSectionLike = {
  heading?: unknown;
  type?: unknown;
};

function normalizeHeading(value: unknown) {
  return String(value ?? "")
    .replace(/^#+\s*/, "")
    .replace(/[?:!.,]+$/g, "")
    .trim()
    .toLowerCase();
}

export function isFaqHeading(heading: unknown) {
  const normalized = normalizeHeading(heading);
  return normalized === "faq" || normalized === "faqs" || normalized === "frequently asked questions";
}

export function isFinalWordsHeading(heading: unknown) {
  return normalizeHeading(heading) === "final words";
}

export function orderFinalWordsBeforeFaq<T extends OutlineSectionLike>(sections: T[]) {
  const regularSections: T[] = [];
  const finalSections: T[] = [];
  const faqSections: T[] = [];

  for (const section of sections) {
    if (isFaqHeading(section.heading) || String(section.type ?? "").toLowerCase() === "faq") {
      faqSections.push(section);
    } else if (isFinalWordsHeading(section.heading) || String(section.type ?? "").toLowerCase() === "conclusion") {
      finalSections.push(section);
    } else {
      regularSections.push(section);
    }
  }

  return [...regularSections, ...finalSections, ...faqSections];
}

type MarkdownSection = {
  heading: string;
  body: string[];
};

function splitMarkdownByH2(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const preamble: string[] = [];
  const sections: MarkdownSection[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(?!#)(.+?)\s*$/);
    if (headingMatch) {
      sections.push({ heading: headingMatch[1].trim(), body: [line] });
      continue;
    }

    const current = sections.at(-1);
    if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }

  return { preamble, sections };
}

export function enforceFinalWordsBeforeFaq(markdown: string) {
  const { preamble, sections } = splitMarkdownByH2(markdown);
  if (!sections.some((section) => isFaqHeading(section.heading)) || !sections.some((section) => isFinalWordsHeading(section.heading))) {
    return markdown;
  }

  const orderedSections = orderFinalWordsBeforeFaq(sections);
  return [...preamble, ...orderedSections.flatMap((section) => section.body)].join("\n");
}
