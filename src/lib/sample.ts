import type { Book } from './types';

// Original demonstration text, licensed with this project. No third-party book content.
const chapters = [
  {
    title: 'The space between words',
    paragraphs: [
      [
        'Reading begins before understanding. You open a book, find a comfortable chair, and lend your attention to a voice you have never heard. For a while, another person gets to arrange the furniture of your mind.',
        '阅读在理解之前就开始了。你翻开一本书，找一把舒服的椅子，把注意力交给一个从未听过的声音。在这一小段时间里，另一个人得以重新摆放你心中的家具。',
      ],
      [
        'A sentence can cross an ocean more easily than its meaning. The words arrive intact, but the associations they carry may not. A familiar joke becomes a puzzle. An ordinary object becomes a symbol whose history we do not know.',
        '一句话跨越海洋，往往比它的含义更容易。文字完整地抵达了，它们携带的联想却未必如此。一个熟悉的笑话变成谜题，一件普通的物品变成了我们不了解其来历的象征。',
      ],
      [
        'Translation builds a bridge across this distance. A good bridge lets us cross without thinking about its structure. Yet sometimes the most interesting part of the journey is to stop in the middle and look at both shores.',
        '翻译在这段距离上架起桥梁。一座好桥让我们不必留意结构就能通行。但有时，旅途中最有意思的部分，是在桥中央停下来，看看两岸。',
      ],
      [
        'To understand a passage is to notice not only what it says, but what it asks you to bring.',
        '理解一段文字，不只是留意它说了什么，还要留意它期待你带来什么。',
      ],
      [
        'Consider the phrase “a room of one’s own.” It can describe a physical space, but in an argument about creative work it may also stand for time, independence, and permission. A literal translation opens the door. Context tells us why the room matters.',
        '以“属于自己的房间”为例。它可以指一个真实的空间，但在关于创作的讨论中，也可能代表时间、独立和自主的许可。直译为我们打开了门，语境则告诉我们这个房间为什么重要。',
      ],
      [
        'This is why asking a small question can change the scale of a book. “What does this word mean here?” is a different question from “What does this word mean?” The first invites the surrounding sentences into the conversation.',
        '因此，一个小问题就能改变我们理解一本书的尺度。“这个词在这里是什么意思？”和“这个词是什么意思？”是不同的问题。前者邀请周围的句子一起参与讨论。',
      ],
      [
        'There is no need to understand everything at once. Leave a mark beside a difficult sentence. Carry the question forward. A later paragraph may offer the missing piece, and returning to the earlier page becomes part of the reading rather than an interruption.',
        '你不必一次理解所有内容。在难懂的句子旁做个标记，带着问题继续读。后面的某一段或许会给出缺失的线索；回到前页，也就成为阅读的一部分，而不是打断。',
      ],
    ],
  },
  {
    title: 'A conversation with the page',
    paragraphs: [
      [
        'In the previous chapter, we imagined translation as a bridge. Now imagine the book as a conversation. The author speaks first, but a reader need not remain silent.',
        '上一章中，我们把翻译比作桥梁。现在，把书想象成一场对话。作者先开口，但读者不必始终沉默。',
      ],
      [
        'A useful question has an address. Instead of asking whether a whole book is right, begin with a particular claim. What evidence supports it? What assumption makes the next sentence possible? Which example would make the claim weaker?',
        '一个有用的问题有自己的地址。与其追问整本书是否正确，不如从一个具体观点开始：什么证据支持它？什么前提让下一句话成立？怎样的例子会削弱这个观点？',
      ],
      [
        'An explanation should give you a path back to the page. If it cannot point to the words that support it, you should be able to recognize it as an interpretation rather than a quotation.',
        '解释应该给你一条回到书页的路。如果它无法指出支撑自己的原文，你应当能够辨认出那是一种解读，而不是引文。',
      ],
      [
        'Helpful companions do not do all the thinking for us. They make the next thought easier to reach. Sometimes that means offering an example; sometimes it means admitting that the available passage does not answer the question.',
        '好的阅读伙伴不会替我们完成全部思考，而是让下一个想法更容易抵达。有时这意味着给出一个例子，有时则意味着承认现有段落无法回答这个问题。',
      ],
      [
        'Keep separate notes for what the author says and what you think. The distance between those two notes is often where learning happens.',
        '分别记录作者说了什么，以及你自己怎么想。这两条笔记之间的距离，往往就是学习发生的地方。',
      ],
    ],
  },
  {
    title: 'Returning with new eyes',
    paragraphs: [
      [
        'A reading history is more than a list of finished titles. It is a record of changing questions. The paragraph you highlighted last month may matter today for an entirely different reason.',
        '阅读史不只是一份已读书单，也是问题不断变化的记录。上个月划线的那一段，今天可能因为完全不同的原因而变得重要。',
      ],
      [
        'Return to the bridge from our first chapter. At first we used it to reach an unfamiliar shore. Later, we discovered that looking back made our own shore unfamiliar too. Another language can reveal the assumptions hidden inside our first one.',
        '再回到第一章的桥。最初，我们借它抵达陌生的彼岸。后来，我们发现，回望也会让自己这一岸变得陌生。另一种语言，能揭示母语中隐藏的假设。',
      ],
      [
        'Good tools preserve these returns. They remember the passage, the question, and the evidence, while leaving room for a different answer. A note should be a doorway, not a verdict.',
        '好的工具会保留这些回访。它们记住段落、问题和证据，同时为不同的答案留下空间。笔记应当是一扇门，而不是一纸判决。',
      ],
      [
        'The goal is not to remove every difficulty from reading. Some difficulties are worth staying with. The goal is to make language less of a barrier, so that more of your attention can go to the ideas on the other side.',
        '阅读的目标不是消除所有困难。有些困难值得停留。我们的目标是降低语言的障碍，让更多注意力能够抵达另一侧的思想。',
      ],
    ],
  },
];

export const sampleBook: Book = {
  id: 'ai-read-original-demo-v1',
  title: 'The Art of Paying Attention',
  author: '叶读 · 原创示例',
  language: 'en',
  sample: true,
  importedAt: 0,
  chapters: chapters.map((c, i) => ({
    id: `chapter-${i}`,
    title: c.title,
    paragraphs: c.paragraphs.map(([text], j) => ({
      id: `${i + 1}.${j + 1}`,
      text,
      kind: i === 0 && j === 3 ? 'quote' : 'text',
    })),
  })),
};
export const sampleTranslations = Object.fromEntries(
  chapters.flatMap((c, i) =>
    c.paragraphs.map(([, translation], j) => [`zh-CN:${i + 1}.${j + 1}:sample`, translation]),
  ),
);
