import type { BookDisplay } from './types';

export type RecommendedBook = BookDisplay & {
  listingOnly: true;
  category: '经济学' | '商业管理';
  isbn: string;
  edition: string;
  publicationYear: number;
  sourceUrl: string;
  sourceLabel: string;
  aliases: string[];
  editorial: Record<'en' | 'zh-CN' | 'zh-TW', { description: string; reason: string }>;
};

// User-approved recommendations. These records contain bibliographic facts and
// our own editorial copy, never third-party book text or invented chapters.
// Public full-text and translation rights have not been supplied for these titles.
// Keep these OUT of the readable catalog and account translation queues.
export const recommendedBooks: RecommendedBook[] = [
  {
    id: 'the-economic-way-of-thinking-13',
    title: 'The Economic Way of Thinking',
    author: 'Paul Heyne · Peter Boettke · David Prychitko',
    language: 'en',
    listingOnly: true,
    category: '经济学',
    publisher: 'Pearson',
    subtitle: '13th edition',
    edition: '13th edition · Paperback',
    publicationYear: 2013,
    isbn: '9780132991292',
    sourceUrl:
      'https://www.pearson.com/en-us/subject-catalog/p/Heyne-Economic-Way-of-Thinking-The-13th-Edition/P200000005920',
    sourceLabel: 'Pearson',
    aliases: ['经济学的思维方式', '經濟學的思維方式', '保罗·海恩'],
    editorial: {
      en: {
        description:
          'An introduction to economic reasoning through opportunity cost, exchange, prices, competition, and the institutions that shape cooperation.',
        reason:
          'Build a framework for understanding markets and incentives. Best read chapter by chapter, with the examples related to decisions you know.',
      },
      'zh-CN': {
        description:
          '从机会成本、交换、价格和竞争出发，理解市场如何协调分散的选择，以及制度如何影响人们的合作。',
        reason: '适合建立分析经济现象的基础。逐章读，把书里的概念与熟悉的商业决策联系起来。',
      },
      'zh-TW': {
        description:
          '從機會成本、交換、價格和競爭出發，理解市場如何協調分散的選擇，以及制度如何影響人們的合作。',
        reason: '適合建立分析經濟現象的基礎。逐章讀，把書裡的概念與熟悉的商業決策聯繫起來。',
      },
    },
  },
  {
    id: 'competition-demystified',
    title: 'Competition Demystified',
    subtitle: 'A Radically Simplified Approach to Business Strategy',
    author: 'Bruce Greenwald · Judd Kahn',
    language: 'en',
    listingOnly: true,
    category: '商业管理',
    publisher: 'Portfolio',
    edition: 'English edition · Paperback',
    publicationYear: 2007,
    isbn: '9781591841807',
    sourceUrl:
      'https://www.penguinrandomhouse.com/books/291699/competition-demystified-by-bruce-greenwald-and-judd-kahn/',
    sourceLabel: 'Penguin Random House · Portfolio',
    aliases: ['竞争优势', '競爭優勢', '竞争战略', '競爭策略', '格林沃尔德'],
    editorial: {
      en: {
        description:
          'A study of competitive advantage centered on barriers to entry, customer captivity, cost advantages, and economies of scale.',
        reason:
          'Connect economics to business strategy: examine whether a company can protect its position as competitors try to enter or expand.',
      },
      'zh-CN': {
        description:
          '围绕进入壁垒、客户黏性、成本优势和规模经济，分析企业的竞争地位及其面临的挑战。',
        reason: '把经济学用于商业判断：一家公司为什么能持续赚钱，又能否在竞争者进入后守住优势。',
      },
      'zh-TW': {
        description:
          '圍繞進入壁壘、客戶黏性、成本優勢和規模經濟，分析企業的競爭地位及其面臨的挑戰。',
        reason: '把經濟學用於商業判斷：一家公司為什麼能持續賺錢，又能否在競爭者進入後守住優勢。',
      },
    },
  },
  {
    id: 'high-output-management',
    title: 'High Output Management',
    author: 'Andrew S. Grove',
    language: 'en',
    listingOnly: true,
    category: '商业管理',
    publisher: 'Vintage',
    edition: 'Vintage edition · Paperback',
    publicationYear: 1995,
    isbn: '9780679762881',
    sourceUrl:
      'https://www.penguinrandomhouse.com/books/72467/high-output-management-by-andrew-s-grove-former-chairman-and-ceo-of-intel/',
    sourceLabel: 'Penguin Random House · Vintage',
    aliases: ['格鲁夫给经理人的第一课', '格魯夫給經理人的第一課', '高产出管理', '高產出管理'],
    editorial: {
      en: {
        description:
          'Andrew Grove draws on his experience at Intel to explain how managers organize work, develop people, and improve team performance.',
        reason:
          'A practical companion for running a team. Compare its management practices with how work and responsibility are organized around you.',
      },
      'zh-CN': {
        description:
          '格鲁夫结合英特尔的管理实践，讨论如何组织工作、培养员工，并提高整个团队的产出。',
        reason: '适合带团队时反复对照阅读，检查分工、协作和人才培养如何影响实际成果。',
      },
      'zh-TW': {
        description:
          '格魯夫結合英特爾的管理實踐，討論如何組織工作、培養員工，並提高整個團隊的產出。',
        reason: '適合帶團隊時反覆對照閱讀，檢查分工、協作和人才培養如何影響實際成果。',
      },
    },
  },
  {
    id: 'the-company-of-strangers-revised',
    title: 'The Company of Strangers',
    subtitle: 'A Natural History of Economic Life',
    author: 'Paul Seabright',
    language: 'en',
    listingOnly: true,
    category: '经济学',
    publisher: 'Princeton University Press',
    edition: 'Revised edition · Paperback',
    publicationYear: 2010,
    isbn: '9780691146461',
    sourceUrl: 'https://www.jstor.org/stable/j.ctt7swb9',
    sourceLabel: 'Princeton University Press · JSTOR',
    aliases: ['陌生人的社会', '陌生人的社會', '保罗·西布莱特'],
    editorial: {
      en: {
        description:
          'An exploration of how trust, institutions, and cooperation among strangers make modern economic life possible, and why those arrangements can be fragile.',
        reason:
          'Look beyond individual transactions to the social foundations of markets. A thoughtful companion to books about competition and management.',
      },
      'zh-CN': {
        description:
          '从信任、制度与陌生人之间的合作，解释现代经济生活如何成为可能，以及这种合作为何也会显得脆弱。',
        reason: '把视野从单次交易扩展到市场的社会基础，与竞争战略和企业管理相互补充。',
      },
      'zh-TW': {
        description:
          '從信任、制度與陌生人之間的合作，解釋現代經濟生活如何成為可能，以及這種合作為何也會顯得脆弱。',
        reason: '把視野從單次交易擴展到市場的社會基礎，與競爭策略和企業管理相互補充。',
      },
    },
  },
  {
    id: 'the-goal-30th-anniversary',
    title: 'The Goal',
    subtitle: 'A Process of Ongoing Improvement',
    author: 'Eliyahu M. Goldratt · Jeff Cox',
    language: 'en',
    listingOnly: true,
    category: '商业管理',
    publisher: 'North River Press',
    edition: '30th Anniversary edition · Paperback',
    publicationYear: 2014,
    isbn: '9780884271956',
    sourceUrl: 'https://northriverpress.com/the-goal-30th-anniversary-edition/',
    sourceLabel: 'North River Press',
    aliases: ['目标', '目標', '高德拉特', '制约理论', '限制理論'],
    editorial: {
      en: {
        description:
          'A management novel about a plant manager working to save his factory. Its story introduces the Theory of Constraints and the pursuit of ongoing improvement.',
        reason:
          'Explore how bottlenecks affect overall performance. Read the manufacturing examples alongside the constraints in your own organization.',
      },
      'zh-CN': {
        description:
          '一位工厂经理在危机中重新审视经营方式。故事引出制约理论，以及围绕整体目标持续改进的方法。',
        reason: '适合关注运营效率的读者。通过工厂中的瓶颈，反思自己的组织真正受什么因素限制。',
      },
      'zh-TW': {
        description:
          '一位工廠經理在危機中重新審視經營方式。故事引出限制理論，以及圍繞整體目標持續改善的方法。',
        reason: '適合關注營運效率的讀者。透過工廠中的瓶頸，反思自己的組織真正受什麼因素限制。',
      },
    },
  },
];

export function recommendationCopy(book: RecommendedBook, locale: string) {
  return book.editorial[locale === 'zh-TW' ? 'zh-TW' : locale.startsWith('zh') ? 'zh-CN' : 'en'];
}

export function isRecommendedBook(book: BookDisplay): book is RecommendedBook {
  return book.listingOnly === true;
}
