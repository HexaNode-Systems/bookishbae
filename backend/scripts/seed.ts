/**
 * Seeds BookishBae with three complete, sellable e-books.
 *
 * "Sample data" for a bookshop is not three rows with lorem ipsum — a product
 * page needs a real cover to lay out against and a real PDF to deliver, or the
 * first thing you discover in production is that your delivery path was never
 * exercised. So this script generates genuine artefacts:
 *
 *   • a multi-page PDF per title, with a title page, chapters and page numbers
 *   • a free sample PDF: the opening pages plus a buy prompt
 *   • a 1200x1800 cover PNG, drawn with the real brand typefaces
 *
 * then uploads them to Cloudinary and writes the catalogue rows.
 *
 * Usage:
 *   npm run seed            upload to Cloudinary and insert into Supabase
 *   npm run seed:dry        generate into scripts/.generated/ and stop
 *
 * The dry run needs no credentials at all, which makes it a quick way to check
 * the generator or preview a cover before touching an environment.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run') || args.has('--dry');
const OUT_DIR = path.join(process.cwd(), 'scripts', '.generated');

// ---------------------------------------------------------------------------
// Brand palette, duplicated from globals.css as RGB
// ---------------------------------------------------------------------------

const CREAM = { r: 0xfd, g: 0xf8, b: 0xf2 };
const PLUM = { r: 0x4c, g: 0x1e, b: 0x43 };
const ROSEGOLD = { r: 0xb9, g: 0x70, b: 0x7b };
const INK = { r: 0x2c, g: 0x1b, b: 0x26 };

const css = (c: { r: number; g: number; b: number }) => `rgb(${c.r},${c.g},${c.b})`;
const pdf = (c: { r: number; g: number; b: number }) => rgb(c.r / 255, c.g / 255, c.b / 255);

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

interface SeedBook {
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  description: string;
  categorySlug: string;
  pricePaise: number;
  discountPricePaise: number | null;
  isFeatured: boolean;
  /** Exercises the watermarking path on one title. */
  watermarkEnabled: boolean;
  chapters: { heading: string; paragraphs: string[] }[];
  reviews: { authorName: string; rating: number; title: string; body: string }[];
}

const BOOKS: SeedBook[] = [
  {
    slug: 'the-long-afternoon',
    title: 'The Long Afternoon',
    subtitle: 'A novella',
    excerpt: 'Two sisters, one unopened letter, and the four hours it took to decide everything.',
    description:
      'Rekha has not been back to the house in Nagpur since the year the tamarind tree came down. ' +
      'She arrives on a Tuesday to sort papers and is met instead by her sister Devi, a thermos of ' +
      'weak tea, and an envelope nobody has had the nerve to open.\n\n' +
      'The Long Afternoon takes place almost entirely in one room, across four hours, between two ' +
      'women who have each spent twenty years deciding what the other must have meant. It is a story ' +
      'about the particular cruelty of being understood slightly wrongly by someone who loves you, ' +
      'and about how little it takes to put that right once anyone is willing to go first.',
    categorySlug: 'literary-fiction',
    pricePaise: 39900,
    discountPricePaise: 29900,
    isFeatured: true,
    watermarkEnabled: true,
    chapters: [
      {
        heading: 'One',
        paragraphs: [
          'The house had decided, in her absence, to become smaller. Rekha noticed it the way you notice a person has cut their hair — not at once, but as a wrongness that takes a moment to name. The corridor was the same corridor. The tiles were the same cold tiles. And yet she had to turn her shoulders to pass the almirah, and she was almost certain she had never had to do that before.',
          'Devi was in the back room with the papers. She had made two piles on the floor, and between them, like a referee, a steel thermos.',
          '"You came," Devi said, not looking up.',
          '"I said I would come."',
          '"You said that in March."',
          'There was no good answer to that, so Rekha sat down on the floor, which she had not done in that room since she was perhaps nineteen, and which her knees now treated as a provocation.',
        ],
      },
      {
        heading: 'Two',
        paragraphs: [
          'The piles, it turned out, were not organised by year or by importance but by whether Devi had already cried over them. Rekha did not ask this directly. She worked it out from the way her sister handled each sheet, and from the fact that the smaller pile contained the electricity bills.',
          'By the second hour they had developed a rhythm. Devi read out a name; Rekha said keep or throw; neither of them mentioned that they had not once disagreed.',
          '"Mrs. Fernandes," Devi said. "Nineteen eighty-eight. She wants to know if Amma is free on the twelfth."',
          '"Throw."',
          '"She signed it with love."',
          '"Everyone signed everything with love in nineteen eighty-eight. Throw it."',
          'Devi threw it, and then, a moment later, picked it out of the bag again and put it in the smaller pile, and Rekha said nothing at all.',
        ],
      },
      {
        heading: 'Three',
        paragraphs: [
          'The envelope was at the bottom of the trunk, under a folded sari that nobody had worn and nobody had been able to give away. It was addressed in their mother\'s hand to both of them, which was the part that made it impossible.',
          'If it had been addressed to Rekha, Devi would have handed it over and left the room, and been generous about it for twenty years. If it had been addressed to Devi, Rekha would have gone to the kitchen and made a show of finding something to do. Addressed to both of them, it required a decision, and they had never once in their lives made one of those together.',
          'They looked at it for a while.',
          '"She wrote this after," Devi said.',
          '"I know when she wrote it."',
          '"Then you know what it says."',
          '"I know what I think it says." Rekha put her hand flat on the floor beside the envelope, not touching it. "That\'s not the same thing, and I\'ve had twenty years of confusing the two."',
        ],
      },
      {
        heading: 'Four',
        paragraphs: [
          'The light in that room went orange at about four and stayed that way for an hour, which is why their mother had always done her accounts there, and why neither of them had ever been able to lie in it.',
          'Devi opened the envelope. She did not read it aloud. She read it once to herself, and her face did something complicated, and then she turned it around and held it out so that they could both see it at the same time.',
          'It was four lines long. Three of them were about the tamarind tree.',
          'Rekha laughed before she could stop herself, and once she had started, the sound went somewhere she had not expected, and Devi came and sat beside her on the floor and did not say it was all right, which was the kindest thing available.',
          'Later, in the kitchen, Devi poured out the last of the tea, which had gone cold and was undrinkable, and both of them drank it.',
        ],
      },
    ],
    reviews: [
      {
        authorName: 'Shruti B.',
        rating: 5,
        title: 'Four hours, one room, completely wrecked me',
        body: 'I read it on a Sunday morning expecting to dip in and read a chapter. I finished it in one sitting and then sat on my balcony for twenty minutes. The thing about the orange light at four is so exactly right.',
      },
      {
        authorName: 'Nikhil R.',
        rating: 5,
        title: 'The dialogue does all the work',
        body: 'Barely any description and you still know that house better than your own. The bit where Devi takes the letter back out of the bag — I had to put the phone down.',
      },
      {
        authorName: 'Preeti M.',
        rating: 4,
        title: 'Wanted a hundred more pages',
        body: 'My only complaint is the length, which is probably the point. Beautiful, restrained writing. I have already sent it to my sister, which may have been a mistake.',
      },
    ],
  },
  {
    slug: 'letters-i-never-sent',
    title: 'Letters I Never Sent',
    subtitle: 'Nine short stories',
    excerpt: 'Nine people, nine drafts folded into nine drawers. Nothing posted, everything said.',
    description:
      'A landlord composing a eulogy for a tenant he disliked. A bride writing to the woman her ' +
      'husband almost married. A son drafting, for the eleventh time, the paragraph in which he ' +
      'tells his father he is not going back to Dubai.\n\n' +
      'Nine stories, each built around a letter that never left the house. They are short — most ' +
      'will take you ten minutes — and they are meant to be read one at a time, preferably in the ' +
      'gap between something ending and the next thing starting.',
    categorySlug: 'short-stories',
    pricePaise: 24900,
    discountPricePaise: null,
    isFeatured: false,
    watermarkEnabled: false,
    chapters: [
      {
        heading: 'The Eleventh Draft',
        paragraphs: [
          'Dear Appa, he wrote, and then looked at it for eleven minutes, which was longer than he had looked at anything in Dubai.',
          'The first draft had been four pages and had contained the word "suffocating", which he had deleted on the grounds that it was true. The fourth had been a single line. The seventh had opened with a joke about the weather and had gone downhill from there, as things that open with jokes about the weather tend to.',
          'This one, the eleventh, he had decided, would simply contain the information. He was not going back. The flat had been given up. The money, what was left of it, was in a fixed deposit in his mother\'s name, which was not an accident and which his father would understand immediately.',
          'He wrote all of that. It took four lines. Then he wrote, underneath, I know what you gave up to send me, and that is the part I cannot find a way to say, and then he folded the page twice and put it in the drawer with the other ten, and went downstairs, and told him.',
        ],
      },
      {
        heading: 'A Good Tenant',
        paragraphs: [
          'Mr. Pinto had been a terrible tenant and an exhausting human being, and the family had asked Mr. Siqueira, as the landlord of eleven years, to say a few words.',
          'He began three times. Each time the sentence that arrived was true, and each time he recognised that nobody at a funeral wants the truth, they want the shape of it.',
          'He went to find the rent book instead. Eleven years of entries in his own hand: paid, paid, paid late, paid, a gap of four months in 2019 with a pencil note saying hospital, then paid, paid, paid.',
          'At the service he said: he paid his rent for eleven years, and in all that time he never once asked me for anything, and I never once asked him how he was. Then he sat down, and the daughter looked at him for a long moment, and nodded.',
        ],
      },
      {
        heading: 'The Other Shortlist',
        paragraphs: [
          'The letter was addressed to a woman she had never met and would have recognised anywhere, because there was a photograph of her in a shoebox in the spare room, and because her husband said her name in the particular neutral tone people reserve for names they have practised being neutral about.',
          'Dear Anjali, she wrote. I am not writing this to be cruel and I am certainly not going to send it.',
          'What followed was two pages, of which only the last paragraph surprised her as she wrote it. I think the version of him you knew would have been easier to live with, it said. I think I got the one who had already decided to be careful. I do not know which of us got the better end of that and I have stopped trying to find out.',
          'She read it back, corrected a comma, and put it in the drawer. It is still there. It is, she would tell you if you asked her, the kindest thing she has ever written about her own marriage.',
        ],
      },
    ],
    reviews: [
      {
        authorName: 'Aditi V.',
        rating: 5,
        title: 'Perfect commute reading',
        body: 'One story per metro ride. "A Good Tenant" is four pages long and I thought about it for a week. The rent book as a record of a whole relationship — brilliant.',
      },
      {
        authorName: 'Harish K.',
        rating: 4,
        title: 'Uneven but the highs are very high',
        body: 'Two or three of the nine did not land for me, which is a decent ratio for a collection. "The Eleventh Draft" alone is worth the price.',
      },
    ],
  },
  {
    slug: 'everything-we-didnt-say',
    title: "Everything We Didn't Say",
    subtitle: 'A novel',
    excerpt: 'They were polite to each other for eleven years. This is the summer that stopped working.',
    description:
      'Maya and Imran were introduced at a wedding in Hyderabad and were, by every measure anyone ' +
      'applied, extremely well suited. They have been married for eleven years. They have never had ' +
      'a serious fight, which Maya has always offered as evidence and which Imran has always ' +
      'suspected is the problem.\n\n' +
      'When Imran\'s mother moves in for the monsoon, the household acquires a witness — and a woman ' +
      'who has no patience at all for the elaborate politeness her son has mistaken for a happy ' +
      'marriage. A warm, talkative novel about the difference between peace and avoidance.',
    categorySlug: 'romance',
    pricePaise: 29900,
    discountPricePaise: 19900,
    isFeatured: false,
    watermarkEnabled: false,
    chapters: [
      {
        heading: 'June',
        paragraphs: [
          'The thing about Maya and Imran, his mother announced on the second evening, with the air of a woman delivering a diagnosis, is that you are both so well behaved.',
          'Maya, who had spent the afternoon making three kinds of chutney specifically so that this conversation would not happen, said that she would take that as a compliment.',
          '"Take it however you like," said Ammi, and helped herself to the chutney.',
          'Imran said nothing, because he had spent eleven years establishing that saying nothing was the responsible option, and because his mother had just described his marriage more accurately in one sentence than he had managed in a decade.',
        ],
      },
      {
        heading: 'July',
        paragraphs: [
          'The rain came in properly on the ninth and did not stop for six days, and the flat, which had always been exactly the right size for two polite people, revealed itself to be considerably smaller than that.',
          'They discovered, in that week, that they disagreed about the window. About whether the window should be open two inches, as it had been every monsoon for eleven years, or closed, as Imran had apparently wanted every monsoon for eleven years without mentioning it.',
          '"Why didn\'t you say?"',
          '"Because it\'s a window, Maya."',
          '"It\'s eleven years of a window."',
          'Ammi, from the next room, said: now we are getting somewhere.',
        ],
      },
      {
        heading: 'August',
        paragraphs: [
          'What they had, Maya decided somewhere around the middle of the month, was not a bad marriage. It was a well-maintained one. They had kept it the way you keep a car you are frightened of: regular servicing, nothing ambitious, never above fifty.',
          'She told him this on the terrace, badly, with several false starts, and he listened with his jaw set in the way that had always meant he was hurt and had for eleven years been read as him being calm.',
          'Then he said: "I thought you liked it like this." And she said: "I thought you did." And they sat with that for a while, in the particular silence of two people realising they have been exquisitely considerate of a person who does not exist.',
          'Downstairs, Ammi had gone to bed early, on purpose, and was lying in the dark listening to the two of them finally raise their voices, and smiling at the ceiling.',
        ],
      },
    ],
    reviews: [
      {
        authorName: 'Fatima S.',
        rating: 5,
        title: 'The mother-in-law is the hero',
        body: 'I have never wanted to high-five a fictional character so much. The window argument is the best-observed fight I have read in years, precisely because it is about nothing.',
      },
      {
        authorName: 'Rohit D.',
        rating: 5,
        title: 'Uncomfortably accurate',
        body: 'Read this with my wife over two weeks and we kept stopping to say "that is us". Funnier than the description suggests, and much kinder than it could have been.',
      },
      {
        authorName: 'Sneha T.',
        rating: 4,
        title: 'Slow start, excellent second half',
        body: 'June took me a while. From the rain onwards I could not put it down.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Cover generation
// ---------------------------------------------------------------------------

const COVER_WIDTH = 1200;
const COVER_HEIGHT = 1800;

function registerFonts(): { serif: string; sans: string } {
  const serif = 'BB Playfair';
  const sans = 'BB Inter';

  const files: [string, string][] = [
    ['@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff', serif],
    ['@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff', serif],
    ['@fontsource/inter/files/inter-latin-500-normal.woff', sans],
    ['@fontsource/inter/files/inter-latin-400-normal.woff', sans],
  ];

  for (const [relative, family] of files) {
    try {
      GlobalFonts.registerFromPath(path.join(process.cwd(), 'node_modules', relative), family);
    } catch {
      // Fall back to whatever the system has. The cover will still render; it
      // will just not be in the brand typeface.
      console.warn(`  (could not register ${relative}; falling back to a system font)`);
    }
  }

  return { serif, sans };
}

/** Greedy word wrap against a measured canvas context. */
function wrapCanvasText(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function renderCover(book: SeedBook, fonts: { serif: string; sans: string }): Buffer {
  const canvas = createCanvas(COVER_WIDTH, COVER_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Paper
  ctx.fillStyle = css(CREAM);
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);

  // A faint speckle so the flat fill does not look like a placeholder.
  ctx.fillStyle = 'rgba(76,30,67,0.045)';
  for (let i = 0; i < 2600; i += 1) {
    const x = Math.random() * COVER_WIDTH;
    const y = Math.random() * COVER_HEIGHT;
    ctx.fillRect(x, y, Math.random() < 0.15 ? 2 : 1, 1);
  }

  // Plum band across the foot, where the author furniture goes.
  const bandTop = COVER_HEIGHT * 0.73;
  ctx.fillStyle = css(PLUM);
  ctx.fillRect(0, bandTop, COVER_WIDTH, COVER_HEIGHT - bandTop);

  // Rose-gold hairline above the band.
  ctx.fillStyle = css(ROSEGOLD);
  ctx.fillRect(110, bandTop - 46, COVER_WIDTH - 220, 3);

  const margin = 110;
  const textWidth = COVER_WIDTH - margin * 2;

  // Imprint
  ctx.fillStyle = css(ROSEGOLD);
  ctx.font = `500 30px "${fonts.sans}"`;
  ctx.letterSpacing = '6px';
  ctx.fillText('BOOKISHBAE', margin, 190);
  ctx.letterSpacing = '0px';

  // Title
  ctx.fillStyle = css(INK);
  const titleSize = book.title.length > 22 ? 104 : 124;
  ctx.font = `700 ${titleSize}px "${fonts.serif}"`;
  const titleLines = wrapCanvasText(ctx, book.title, textWidth);
  let y = 420;
  for (const line of titleLines) {
    ctx.fillText(line, margin, y);
    y += titleSize * 1.1;
  }

  // Subtitle
  ctx.fillStyle = 'rgba(44,27,38,0.62)';
  ctx.font = `400 42px "${fonts.serif}"`;
  ctx.fillText(book.subtitle, margin, y + 28);

  // Pull-quote from the excerpt, sitting above the band.
  ctx.fillStyle = 'rgba(44,27,38,0.82)';
  ctx.font = `400 38px "${fonts.serif}"`;
  const excerptLines = wrapCanvasText(ctx, book.excerpt, textWidth).slice(0, 3);
  let ey = bandTop - 150 - (excerptLines.length - 1) * 54;
  for (const line of excerptLines) {
    ctx.fillText(line, margin, ey);
    ey += 54;
  }

  // Author, optically centred in the band rather than hung from its top edge.
  const bandHeight = COVER_HEIGHT - bandTop;
  const authorBaseline = bandTop + bandHeight / 2 + 10;

  ctx.fillStyle = css(CREAM);
  ctx.font = `700 92px "${fonts.serif}"`;
  ctx.fillText('Annu', margin, authorBaseline);

  ctx.fillStyle = 'rgba(253,248,242,0.62)';
  ctx.font = `400 26px "${fonts.sans}"`;
  ctx.letterSpacing = '4px';
  ctx.fillText('STORIES THAT STAY WITH YOU', margin, authorBaseline + 62);
  ctx.letterSpacing = '0px';

  return canvas.toBuffer('image/png');
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595.28; // A5-ish portrait at 72dpi, comfortable on a phone
const PAGE_HEIGHT = 841.89;
const MARGIN = 64;
const BODY_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LEADING = 17.5;

interface PdfFonts {
  body: PDFFont;
  italic: PDFFont;
  heading: PDFFont;
  sans: PDFFont;
}

/** Greedy wrap using pdf-lib's own metrics, so the measurement matches the draw. */
function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * pdf-lib's standard fonts are WinAnsi-encoded and throw on characters outside
 * it. Curly quotes are the ones that actually turn up in prose, so normalise
 * them rather than discovering the problem at generation time.
 */
function toWinAnsi(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7e¡-ÿ]/g, '');
}

class BookWriter {
  private doc!: PDFDocument;
  private fonts!: PdfFonts;
  private page!: PDFPage;
  private cursor = 0;
  private pageNumber = 0;

  constructor(
    private readonly book: SeedBook,
    private readonly runningHead: string,
  ) {}

  async init() {
    this.doc = await PDFDocument.create();
    this.doc.setTitle(this.book.title);
    this.doc.setAuthor('Annu');
    this.doc.setSubject(this.book.excerpt);
    this.doc.setProducer('BookishBae');
    this.doc.setCreator('BookishBae');
    this.doc.setCreationDate(new Date());

    this.fonts = {
      body: await this.doc.embedFont(StandardFonts.TimesRoman),
      italic: await this.doc.embedFont(StandardFonts.TimesRomanItalic),
      heading: await this.doc.embedFont(StandardFonts.TimesRomanBold),
      sans: await this.doc.embedFont(StandardFonts.Helvetica),
    };

    return this;
  }

  private newPage(withFurniture = true) {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pageNumber += 1;
    this.page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: pdf(CREAM),
    });
    this.cursor = PAGE_HEIGHT - MARGIN;

    if (withFurniture && this.pageNumber > 1) {
      this.page.drawText(toWinAnsi(this.runningHead), {
        x: MARGIN,
        y: 34,
        size: 8,
        font: this.fonts.sans,
        color: pdf(ROSEGOLD),
      });
      const label = String(this.pageNumber);
      this.page.drawText(label, {
        x: PAGE_WIDTH - MARGIN - this.fonts.sans.widthOfTextAtSize(label, 8),
        y: 34,
        size: 8,
        font: this.fonts.sans,
        color: pdf(ROSEGOLD),
      });
    }
  }

  private ensureSpace(needed: number) {
    if (this.cursor - needed < MARGIN + 30) this.newPage();
  }

  titlePage() {
    this.newPage(false);

    this.page.drawText('BOOKISHBAE', {
      x: MARGIN,
      y: PAGE_HEIGHT - 120,
      size: 9,
      font: this.fonts.sans,
      color: pdf(ROSEGOLD),
    });

    const titleSize = this.book.title.length > 24 ? 30 : 36;
    let y = PAGE_HEIGHT * 0.62;
    for (const line of wrapPdfText(this.book.title, this.fonts.heading, titleSize, BODY_WIDTH)) {
      this.page.drawText(toWinAnsi(line), {
        x: MARGIN,
        y,
        size: titleSize,
        font: this.fonts.heading,
        color: pdf(INK),
      });
      y -= titleSize * 1.18;
    }

    this.page.drawText(toWinAnsi(this.book.subtitle), {
      x: MARGIN,
      y: y - 8,
      size: 14,
      font: this.fonts.italic,
      color: pdf(PLUM),
    });

    this.page.drawRectangle({
      x: MARGIN,
      y: y - 48,
      width: 90,
      height: 1.6,
      color: pdf(ROSEGOLD),
    });

    this.page.drawText('Annu', {
      x: MARGIN,
      y: y - 96,
      size: 20,
      font: this.fonts.heading,
      color: pdf(INK),
    });
  }

  copyrightPage() {
    this.newPage(false);
    const lines = [
      `${this.book.title}`,
      'Copyright (c) Annu. All rights reserved.',
      '',
      'Published by BookishBae.',
      'This e-book is sold DRM-free, for your personal use.',
      'Please do not redistribute it; buying a copy is what lets the',
      'next one get written.',
      '',
      'This is a work of fiction. Names, characters and incidents are',
      'the product of the author\'s imagination.',
      '',
      'First edition.',
    ];

    let y = PAGE_HEIGHT / 2 + 80;
    for (const line of lines) {
      if (line) {
        this.page.drawText(toWinAnsi(line), {
          x: MARGIN,
          y,
          size: 9.5,
          font: this.fonts.sans,
          color: pdf({ r: 0x6b, g: 0x5a, b: 0x66 }),
        });
      }
      y -= 15;
    }
  }

  chapter(heading: string, paragraphs: string[]) {
    this.newPage();
    this.cursor -= 48;

    this.page.drawText(toWinAnsi(heading), {
      x: MARGIN,
      y: this.cursor,
      size: 22,
      font: this.fonts.heading,
      color: pdf(PLUM),
    });
    this.cursor -= 14;

    this.page.drawRectangle({
      x: MARGIN,
      y: this.cursor,
      width: 48,
      height: 1.4,
      color: pdf(ROSEGOLD),
    });
    this.cursor -= 34;

    for (const paragraph of paragraphs) {
      const isDialogue = paragraph.trimStart().startsWith('"');
      const font = isDialogue ? this.fonts.body : this.fonts.body;
      const lines = wrapPdfText(paragraph, font, 11.5, BODY_WIDTH);

      for (const [index, line] of lines.entries()) {
        this.ensureSpace(LEADING);
        this.page.drawText(toWinAnsi(line), {
          // A small first-line indent, the way a printed book does it.
          x: MARGIN + (index === 0 && !isDialogue ? 14 : 0),
          y: this.cursor,
          size: 11.5,
          font,
          color: pdf(INK),
        });
        this.cursor -= LEADING;
      }

      this.cursor -= 6;
    }
  }

  /** Closing page for the free sample, with a reason to come back. */
  samplePrompt(siteUrl: string) {
    this.newPage();
    this.cursor -= 80;

    this.page.drawText('End of sample', {
      x: MARGIN,
      y: this.cursor,
      size: 20,
      font: this.fonts.heading,
      color: pdf(PLUM),
    });
    this.cursor -= 40;

    const body = [
      `This is the opening of ${this.book.title}.`,
      '',
      'The full e-book is available at BookishBae, DRM-free, and lands in',
      'your library the moment the payment goes through.',
      '',
      `${siteUrl}/shop/${this.book.slug}`,
    ];

    for (const line of body) {
      if (line) {
        this.page.drawText(toWinAnsi(line), {
          x: MARGIN,
          y: this.cursor,
          size: 11.5,
          font: this.fonts.body,
          color: pdf(INK),
        });
      }
      this.cursor -= LEADING;
    }
  }

  get pages() {
    return this.pageNumber;
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save();
  }
}

async function buildFullPdf(book: SeedBook) {
  const writer = await new BookWriter(book, `${book.title} - Annu`).init();
  writer.titlePage();
  writer.copyrightPage();
  for (const chapter of book.chapters) {
    writer.chapter(chapter.heading, chapter.paragraphs);
  }
  return { bytes: await writer.save(), pages: writer.pages };
}

async function buildSamplePdf(book: SeedBook, siteUrl: string) {
  const writer = await new BookWriter(book, `${book.title} - sample`).init();
  writer.titlePage();
  const first = book.chapters[0];
  if (first) {
    // Roughly the first half of the opening chapter, which is enough to decide.
    writer.chapter(first.heading, first.paragraphs.slice(0, Math.max(2, Math.ceil(first.paragraphs.length / 2))));
  }
  writer.samplePrompt(siteUrl);
  return { bytes: await writer.save(), pages: writer.pages };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Artefacts {
  book: SeedBook;
  coverPng: Buffer;
  fullPdf: Uint8Array;
  fullPages: number;
  samplePdf: Uint8Array;
}

async function generate(siteUrl: string): Promise<Artefacts[]> {
  const fonts = registerFonts();
  const out: Artefacts[] = [];

  for (const book of BOOKS) {
    process.stdout.write(`  ${book.title} ... `);
    const coverPng = renderCover(book, fonts);
    const full = await buildFullPdf(book);
    const sample = await buildSamplePdf(book, siteUrl);
    out.push({
      book,
      coverPng,
      fullPdf: full.bytes,
      fullPages: full.pages,
      samplePdf: sample.bytes,
    });
    console.log(
      `cover ${(coverPng.length / 1024).toFixed(0)} KB, ` +
        `book ${full.pages}pp / ${(full.bytes.length / 1024).toFixed(0)} KB, ` +
        `sample ${sample.pages}pp`,
    );
  }

  return out;
}

async function writeLocally(artefacts: Artefacts[]) {
  await mkdir(OUT_DIR, { recursive: true });

  for (const { book, coverPng, fullPdf, samplePdf } of artefacts) {
    await writeFile(path.join(OUT_DIR, `${book.slug}-cover.png`), coverPng);
    await writeFile(path.join(OUT_DIR, `${book.slug}.pdf`), fullPdf);
    await writeFile(path.join(OUT_DIR, `${book.slug}-sample.pdf`), samplePdf);
  }

  console.log(`\nWrote ${artefacts.length * 3} files to ${OUT_DIR}`);
}

async function upload(artefacts: Artefacts[]) {
  // Imported here rather than at the top so that `--dry-run` works with no
  // credentials configured at all.
  const { putObject, PRIVATE_BUCKET, PUBLIC_BUCKET } = await import('../src/lib/cloudinary');
  const { db, transaction } = await import('../src/lib/db/postgres');
  const { env } = await import('../src/lib/env');
  const categories = await db.query<{ id: string; slug: string }>('SELECT id,slug FROM public.categories');
  const categoryIdBySlug = new Map((categories ?? []).map((c) => [c.slug, c.id]));

  for (const { book, coverPng, fullPdf, fullPages, samplePdf } of artefacts) {
    console.log(`\n${book.title}`);

    // Deterministic keys so re-running the seed replaces rather than litters.
    const coverKey = `covers/seed/${book.slug}.png`;
    const mainKey = `books/seed/${book.slug}.pdf`;
    const sampleKey = `samples/seed/${book.slug}-sample.pdf`;

    await putObject({
      key: coverKey,
      body: coverPng,
      contentType: 'image/png',
      bucket: PUBLIC_BUCKET,
      cacheControl: 'public, max-age=31536000, immutable',
    });
    console.log(`  cover  -> ${PUBLIC_BUCKET}/${coverKey}`);

    await putObject({
      key: mainKey,
      body: fullPdf,
      contentType: 'application/pdf',
      bucket: PRIVATE_BUCKET,
    });
    console.log(`  book   -> ${PRIVATE_BUCKET}/${mainKey}`);

    await putObject({
      key: sampleKey,
      body: samplePdf,
      contentType: 'application/pdf',
      bucket: PRIVATE_BUCKET,
    });
    console.log(`  sample -> ${PRIVATE_BUCKET}/${sampleKey}`);

    const sha256 = createHash('sha256').update(fullPdf).digest('hex');

    const product = await transaction(async sql => {
      const values = {
          slug: book.slug,
          title: book.title,
          subtitle: book.subtitle,
          excerpt: book.excerpt,
          description: book.description,
          author_name: 'Annu',
          category_id: categoryIdBySlug.get(book.categorySlug) ?? null,
          price_paise: book.pricePaise,
          discount_price_paise: book.discountPricePaise,
          currency: 'INR',
          cover_key: coverKey,
          cover_width: COVER_WIDTH,
          cover_height: COVER_HEIGHT,
          cover_alt: `Cover of ${book.title} by Annu`,
          sample_pdf_key: sampleKey,
          main_pdf_key: mainKey,
          main_pdf_bytes: fullPdf.length,
          main_pdf_sha256: sha256,
          page_count: fullPages,
          language: 'en',
          status: 'published',
          is_featured: book.isFeatured,
          watermark_enabled: book.watermarkEnabled,
          download_limit: env.DOWNLOAD_LIMIT_DEFAULT,
          meta_title: `${book.title} by Annu`,
          meta_description: book.excerpt.slice(0, 160),
          published_at: new Date().toISOString(),
        };
      const columns = Object.keys(values);
      const [saved] = await sql.query<{ id: string; slug: string }>(`INSERT INTO public.products(${columns.join(',')}) VALUES(${columns.map((_,i)=>`$${i+1}`).join(',')}) ON CONFLICT(slug) DO UPDATE SET ${columns.filter(c=>c!=='slug').map(c=>`${c}=excluded.${c}`).join(',')} RETURNING id,slug`,Object.values(values));
      if (!saved) throw new Error('Catalogue seed could not save the product.');
      await sql.query('DELETE FROM public.reviews WHERE product_id=$1 AND user_id IS NULL',[saved.id]);
      for (const review of book.reviews) await sql.query(`INSERT INTO public.reviews(product_id,user_id,author_name,rating,title,body,status,is_verified_purchase) VALUES($1,NULL,$2,$3,$4,$5,'approved',false)`,[saved.id,review.authorName,review.rating,review.title,review.body]);
      return saved;
    });
    console.log(`  row    -> products/${product.slug}`);

    console.log(`  reviews-> ${book.reviews.length} approved`);
  }

  // The hero needs something to feature.
  const featured = BOOKS.find((b) => b.isFeatured);
  if (featured) {
    await db.query(`UPDATE public.site_settings SET value=value || jsonb_build_object('featured_product_slug',$1::text) WHERE key='hero'`,[featured.slug]);

    console.log(`\nHero now features "${featured.title}".`);
  }
}

async function main() {
  console.log(`\nBookishBae seed${DRY_RUN ? ' (dry run)' : ''}\n`);

  const siteUrl = DRY_RUN
    ? (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bookishbae.com')
    : (await import('../src/lib/env')).env.NEXT_PUBLIC_SITE_URL;

  console.log('Generating artefacts:');
  const artefacts = await generate(siteUrl);

  await writeLocally(artefacts);

  if (DRY_RUN) {
    console.log('\nDry run: nothing uploaded, nothing written to the database.');
    console.log('Open the PNGs in scripts/.generated/ to check the covers, then run `npm run seed`.');
    return;
  }

  console.log('\nUploading to Cloudinary and writing the catalogue:');
  await upload(artefacts);

  console.log('\nDone. Three titles are live.\n');
}

main().catch(() => {
  console.error('Catalogue seed failed. Check backend configuration and database connectivity.');
  process.exitCode = 1;
}).finally(async () => { const { closeDatabase } = await import('../src/lib/db/postgres'); await closeDatabase(); });
