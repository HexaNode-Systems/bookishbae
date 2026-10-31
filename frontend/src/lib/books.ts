export interface Book {
  id?: string;
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  description: string;
  category: string;
  categorySlug: string;
  categoryId?: string | null;
  priceRupees: number;
  originalPriceRupees?: number;
  pricePaise: number;
  coverImage: string;
  samplePdfUrl: string;
  pageCount: number;
  isFeatured?: boolean;
  rating: number;
  reviewCount: number;
  publishedDate: string;
  sampleText: {
    heading: string;
    paragraphs: string[];
  }[];
  reviews: {
    authorName: string;
    rating: number;
    title: string;
    body: string;
  }[];
}

export const BOOKS: Book[] = [
  {
    slug: 'the-long-afternoon',
    title: 'The Long Afternoon',
    subtitle: 'A novella',
    excerpt: 'Two sisters, one unopened letter, and the four hours it took to decide everything.',
    description:
      'Rekha has not been back to the house in Nagpur since the year the tamarind tree came down. She arrives on a Tuesday to sort papers and is met instead by her sister Devi, a thermos of weak tea, and an envelope nobody has had the nerve to open.\n\nThe Long Afternoon takes place almost entirely in one room, across four hours, between two women who have each spent twenty years deciding what the other must have meant.',
    category: 'Literary Fiction',
    categorySlug: 'literary-fiction',
    priceRupees: 299,
    originalPriceRupees: 399,
    pricePaise: 29900,
    coverImage: '/covers/the-long-afternoon-cover.png',
    samplePdfUrl: '/samples/the-long-afternoon-sample.pdf',
    pageCount: 68,
    isFeatured: true,
    rating: 4.8,
    reviewCount: 38,
    publishedDate: 'October 2026',
    sampleText: [
      {
        heading: 'Chapter One: The Arrival',
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
        heading: 'Chapter Two: The Small Pile',
        paragraphs: [
          'The piles, it turned out, were not organised by year or by importance but by whether Devi had already cried over them. Rekha did not ask this directly. She worked it out from the way her sister handled each sheet, and from the fact that the smaller pile contained the electricity bills.',
          'By the second hour they had developed a rhythm. Devi read out a name; Rekha said keep or throw; neither of them mentioned that they had not once disagreed.',
          '"Mrs. Fernandes," Devi said. "Nineteen eighty-eight. She wants to know if Amma is free on the twelfth."',
          '"Throw."',
          '"She signed it with love."',
          '"Everyone signed everything with love in nineteen eighty-eight. Throw it."',
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
        title: 'Restrained, beautiful writing',
        body: 'My only complaint is the length, which is probably the point. Beautiful, restrained writing. I have already sent it to my sister.',
      },
    ],
  },
  {
    slug: 'letters-i-never-sent',
    title: 'Letters I Never Sent',
    subtitle: 'Nine short stories',
    excerpt: 'Nine people, nine drafts folded into nine drawers. Nothing posted, everything said.',
    description:
      'A landlord composing a eulogy for a tenant he disliked. A bride writing to the woman her husband almost married. A son drafting, for the eleventh time, the paragraph in which he tells his father he is not going back to Dubai.\n\nNine stories, each built around a letter that never left the house. They are short — most will take you ten minutes — and they are meant to be read one at a time.',
    category: 'Short Stories',
    categorySlug: 'short-stories',
    priceRupees: 249,
    originalPriceRupees: 299,
    pricePaise: 24900,
    coverImage: '/covers/letters-i-never-sent-cover.png',
    samplePdfUrl: '/samples/letters-i-never-sent-sample.pdf',
    pageCount: 112,
    rating: 4.6,
    reviewCount: 29,
    publishedDate: 'September 2026',
    sampleText: [
      {
        heading: 'Story One: The Eleventh Draft',
        paragraphs: [
          'Dear Appa, he wrote, and then looked at it for eleven minutes, which was longer than he had looked at anything in Dubai.',
          'The first draft had been four pages and had contained the word "suffocating", which he had deleted on the grounds that it was true. The fourth had been a single line. The seventh had opened with a joke about the weather and had gone downhill from there, as things that open with jokes about the weather tend to.',
          'This one, the eleventh, he had decided, would simply contain the information. He was not going back. The flat had been given up. The money, what was left of it, was in a fixed deposit in his mother\'s name, which was not an accident and which his father would understand immediately.',
        ],
      },
      {
        heading: 'Story Two: A Good Tenant',
        paragraphs: [
          'Mr. Pinto had been a terrible tenant and an exhausting human being, and the family had asked Mr. Siqueira, as the landlord of eleven years, to say a few words.',
          'He began three times. Each time the sentence that arrived was true, and each time he recognised that nobody at a funeral wants the truth, they want the shape of it.',
          'He went to find the rent book instead. Eleven years of entries in his own hand: paid, paid, paid late, paid, a gap of four months in 2019 with a pencil note saying hospital, then paid, paid, paid.',
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
        title: 'The highs are very high',
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
      'Maya and Imran were introduced at a wedding in Hyderabad and were, by every measure anyone applied, extremely well suited. They have been married for eleven years. They have never had a serious fight, which Maya has always offered as evidence and which Imran has always suspected is the problem.\n\nWhen Imran\'s mother moves in for the monsoon, the household acquires a witness who has no patience at all for the elaborate politeness her son has mistaken for a happy marriage.',
    category: 'Romance',
    categorySlug: 'romance',
    priceRupees: 199,
    originalPriceRupees: 299,
    pricePaise: 19900,
    coverImage: '/covers/everything-we-didnt-say-cover.png',
    samplePdfUrl: '/samples/everything-we-didnt-say-sample.pdf',
    pageCount: 148,
    rating: 4.7,
    reviewCount: 45,
    publishedDate: 'August 2026',
    sampleText: [
      {
        heading: 'June: The Diagnosis',
        paragraphs: [
          'The thing about Maya and Imran, his mother announced on the second evening, with the air of a woman delivering a diagnosis, is that you are both so well behaved.',
          'Maya, who had spent the afternoon making three kinds of chutney specifically so that this conversation would not happen, said that she would take that as a compliment.',
          '"Take it however you like," said Ammi, and helped herself to the chutney.',
          'Imran said nothing, because he had spent eleven years establishing that saying nothing was the responsible option, and because his mother had just described his marriage more accurately in one sentence than he had managed in a decade.',
        ],
      },
      {
        heading: 'July: The Window',
        paragraphs: [
          'The rain came in properly on the ninth and did not stop for six days, and the flat, which had always been exactly the right size for two polite people, revealed itself to be considerably smaller than that.',
          'They discovered, in that week, that they disagreed about the window. About whether the window should be open two inches, as it had been every monsoon for eleven years, or closed, as Imran had apparently wanted every monsoon for eleven years without mentioning it.',
          '"Why didn\'t you say?"',
          '"Because it\'s a window, Maya."',
          '"It\'s eleven years of a window."',
          'Ammi, from the next room, said: now we are getting somewhere.',
        ],
      },
    ],
    reviews: [
      {
        authorName: 'Sneha T.',
        rating: 5,
        title: 'The mother-in-law steals every scene',
        body: 'Warm, funny, painfully perceptive. The scene with the chutney in chapter one had me laughing aloud on the train.',
      },
      {
        authorName: 'Kunal M.',
        rating: 5,
        title: 'Honest look at long-term marriage',
        body: 'Not a melodramatic breakup story, but something much more real. Recommended to anyone who has ever avoided a difficult conversation for five years.',
      },
    ],
  },
];

export const TESTIMONIALS = [
  {
    quote: 'I started it on the metro and missed my stop. That has not happened to me in years.',
    author: 'Jitendra Kumar.',
    location: 'Lucknow',
    rating: 5,
    book: 'The Long Afternoon',
  },
  {
    quote: 'Annu writes the kind of sentences you put your thumb over and read twice.',
    author: 'Ritesh S.',
    location: 'Bengaluru',
    rating: 5,
    book: 'Letters I Never Sent',
  },
  {
    quote: 'We argued about the ending for a full hour. Best book club meeting we have had.',
    author: 'Fatima A.',
    location: 'Mumbai',
    rating: 5,
    book: "Everything We Didn't Say",
  },
];

export const FAQS = [
  {
    question: 'What format are the e-books in?',
    answer:
      'Every title is delivered as a clean, DRM-free PDF, with beautiful typography designed for easy reading on smartphones, iPads, Kindle/Kobo e-readers, or laptops.',
  },
  {
    question: 'How do I receive my book after paying?',
    answer:
      'Instantly! The moment your payment succeeds, your download begins right on screen. You also receive an email with your download links and your book is stored in your account library.',
  },
  {
    question: 'Can I re-download my book in the future?',
    answer:
      'Yes. Your purchases come with lifetime re-download rights (up to 5 downloads per book). Simply sign in with the email address you purchased with.',
  },
  {
    question: 'Which payment methods are supported?',
    answer:
      'We accept all Indian and international payment methods through Cashfree Payments: UPI (Google Pay, PhonePe, Paytm, BHIM), Credit/Debit Cards (Visa, Mastercard, RuPay), and Net Banking across 50+ banks.',
  },
  {
    question: 'Are payments secure?',
    answer:
      '100%. We do not store any card or banking credentials. All transactions are encrypted and processed through Cashfree Payments with bank-grade 256-bit SSL encryption.',
  },
];
