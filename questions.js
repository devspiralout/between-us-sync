// ————————————————————————————————————————————————
// THE QUESTION BANK — edit freely. Add, remove, or rewrite
// any line. Each theme is just a list of strings.
// ————————————————————————————————————————————————

const THEMES = {
  childhood: { label: "Childhood & memory", color: "#D9A86C" },
  values: { label: "Values & beliefs", color: "#A8BF8F" },
  us: { label: "Us", color: "#D78F9E" },
  future: { label: "Dreams & the future", color: "#8FB6C9" },
  fears: { label: "Fears & soft spots", color: "#A793C9" },
  gratitude: { label: "Gratitude", color: "#E0BF7E" },
  playful: { label: "Playful", color: "#E59B8B" },
  hypothetical: { label: "Hypotheticals", color: "#9BAED1" },
  desire: { label: "Desire & heat", color: "#C2607A" },
  afterdark: { label: "After dark · 18+", color: "#A8384F" },
};

const QUESTION_BANK = {
  childhood: [
    "What smell takes you straight back to being small — and where exactly does it take you?",
    "What did you believe about adulthood as a kid that turned out to be completely wrong?",
    "Who made you feel safest growing up, and what did they actually do?",
    "What's a rule from your childhood home you've kept without ever questioning it?",
    "What were you praised for as a child — and do you still chase that?",
    "What's a moment from before you were ten that you've never told me about?",
    "What toy, place, or ritual did you love that nobody else understood?",
    "When did you first feel like an outsider?",
    "What did your family argue about, and how did arguments usually end?",
    "What's something a teacher said that stuck with you — for better or worse?",
    "If you could sit with your eight-year-old self for an hour, what would the two of you do?",
    "What part of your childhood would you want to recreate for a child — and what part would you protect them from?",
    "What's the first time you remember being truly proud of yourself?",
    "What did 'home' smell, sound, and feel like at its very best?",
    "What childhood nickname or label did you outgrow — or never quite did?",
  ],
  values: [
    "What's a belief you hold that most people you love don't share?",
    "What's something you've genuinely changed your mind about in the last five years?",
    "When you have a hard call to make, whose voice do you hear in your head?",
    "What does 'enough' look like to you — money, success, love?",
    "What would you never compromise on — and what's secretly more negotiable than you admit?",
    "What do you judge other people for that you sometimes do yourself?",
    "What's a conviction you inherited rather than chose?",
    "Where do you think your sense of right and wrong actually comes from?",
    "What's the kindest thing you believe about people? And the harshest?",
    "What is worth being late for?",
    "What would you want said about you, in one sentence, at the very end?",
    "What do you think we owe strangers?",
    "When is it okay to give up on something?",
    "What's a small daily choice that feels quietly moral to you?",
    "If you could pass on exactly one value to a child, which one would survive the cut?",
  ],
  us: [
    "When did you first think 'this might be it' — or are you still waiting on that moment?",
    "What do I do that makes you feel most loved, even if it's tiny?",
    "What's a disagreement of ours we never quite finished?",
    "What part of us would you never want to lose, even decades from now?",
    "What do you wish I asked you about more often?",
    "When have you felt furthest from me — and what brought you back?",
    "What's something you've wanted to say, but the timing never felt right?",
    "What do we do better than any couple you know?",
    "What habit of mine secretly delights you?",
    "Where do you feel us growing right now — and where are we coasting?",
    "What did you assume about me early on that turned out to be wrong?",
    "What's your favorite completely ordinary day we've ever had?",
    "What's one thing you need more of from me lately?",
    "If you wrote our story so far in three chapters, what would they be called?",
    "What does it feel like when we repair things after a hard moment?",
  ],
  future: [
    "What's a life you could have lived if one decision had gone the other way?",
    "Where do you picture us on a random Tuesday, ten years from now?",
    "What dream have you quietly shelved that still tugs at you?",
    "What do you want to be true about your seventies?",
    "If money stopped mattering tomorrow, what would Monday morning look like?",
    "What's something you want us to try before this year ends?",
    "What skill do you wish you were already ten years into?",
    "What kind of old person are you hoping to become?",
    "What would you do with one completely free year — no obligations, no guilt?",
    "What's a place you've never seen that feels strangely like homesickness?",
    "What do you hope we never stop doing?",
    "What's a version of success you'd feel in your body, not just on paper?",
    "What's something you want to make — with your hands, your words, your time?",
    "Which chapter of life are you most looking forward to?",
    "If we made one promise about the future tonight, what should it be?",
  ],
  fears: [
    "What's a fear you've never said out loud?",
    "When do you feel most like an impostor?",
    "What's the loneliest you've ever been?",
    "What do you worry I'd think less of you for?",
    "What do you do when you're hurting that I might not recognize as hurting?",
    "What's a kind of loss you don't feel ready for?",
    "What old wound still flinches when something touches it?",
    "What's the hardest thing you've forgiven — or are still trying to?",
    "When do you feel smallest?",
    "What do you pretend not to care about?",
    "What's a way you protect yourself that sometimes keeps good things out too?",
    "What's something you're avoiding right now, even a little?",
    "What did you learn to hide early in life?",
    "On your worst day, what exactly would you want me to do?",
    "What truth about yourself took you the longest to accept?",
  ],
  gratitude: [
    "What's something completely ordinary you'd grieve if it vanished?",
    "Who showed up for you once in a way you've never properly thanked?",
    "What's a hard thing you're now glad happened?",
    "What about your body are you grateful for today?",
    "What small luxury makes you feel rich?",
    "What's something I did this month that landed more than you let on?",
    "What part of your daily routine would past-you envy?",
    "Who taught you something essential without ever knowing it?",
    "What's a sound, taste, or texture you're glad exists?",
    "What near-miss are you quietly thankful for?",
    "What's the best gift you've ever received that cost nothing?",
    "What about this exact season of life will you miss someday?",
    "What's something you have now that you once only wished for?",
    "Who do you hope knows what they meant to you?",
    "What made you laugh hardest this year?",
  ],
  playful: [
    "What's your most irrational food opinion, defended to the death?",
    "If we got matching tattoos tonight — terrible idea — what would they be?",
    "What's the pettiest hill you will absolutely die on?",
    "What would your villain origin story be?",
    "What song do you perform flawlessly when you're alone?",
    "What's the weirdest compliment you've ever received?",
    "If our home could leave us a review, what would the one-star version say?",
    "What's your most useless talent?",
    "Which fictional world would you survive about four minutes in?",
    "What do you do when no one's watching that you'd be mildly embarrassed about?",
    "What's a trend you secretly hope comes back?",
    "What would the most dramatic chapter of your autobiography be titled?",
    "If you had to win one bizarre Olympic event, what's your best shot?",
    "What conspiracy theory would you start about the two of us?",
    "What's the most 'you' purchase you've ever made?",
  ],
  hypothetical: [
    "If you could relive one day exactly as it happened, which one?",
    "You get one fully honest answer from anyone, living or dead. Who, and what do you ask?",
    "If we swapped lives for a week, what would surprise you most about mine?",
    "You can erase one invention from history. Which one goes?",
    "If you could know one thing about the future — would you? What?",
    "A letter arrives from yourself at ninety. What does the first line say?",
    "You have to leave the country tomorrow and start over. Where do you go, and what do you take?",
    "You can give every person on earth one feeling for ten seconds. Which feeling?",
    "If your life had a director's commentary, which scene needs the most explaining?",
    "You wake up with one extra sense. What does it detect?",
    "If we opened a tiny shop together, what would we sell?",
    "You can send one sentence to yourself ten years ago. What is it?",
    "If you could borrow one of my memories and live it from the inside, which would you pick?",
    "You must add one mandatory class to every school on earth. What's taught?",
    "If tonight lasted a whole year, what would we do with it?",
  ],
  desire: [
    "What was the first thing about me, physically, that you couldn't stop noticing?",
    "When do you find me most irresistible — and do I know it while it's happening?",
    "What's something you've wanted to try with me but haven't found the words for yet?",
    "Where do you most love being touched that I might not even know about?",
    "What's a fantasy you've never said out loud — and what's held you back?",
    "What do I do that turns you on without even meaning to?",
    "What's the most charged moment we've ever shared, the one you go back to?",
    "Describe the perfect slow evening that ends with us tangled up together.",
    "What's something you find unexpectedly, almost embarrassingly, arousing?",
    "Is there a way of being wanted you wish you got more of from me?",
    "What were you thinking the very first time you wanted to kiss me?",
    "What's a word, or a whisper, that completely undoes you?",
    "When do you feel sexiest in your own skin — and is it ever because of me?",
    "What's the boldest thing you'd do tonight if you knew I'd love it?",
    "For you, what's the difference between being wanted and being loved — and which do you need more of right now?",
  ],
  afterdark: [
    "What's something you want me to do to you in bed that you've never asked for out loud?",
    "Be specific: where do you most want my mouth tonight?",
    "Do you want to be in control or be told exactly what to do — and which do you crave more from me?",
    "What position or act have you been wanting to try that we haven't yet?",
    "What does your body want when you touch yourself thinking about me?",
    "What kind of dirty talk actually works on you — give me an example, in your words.",
    "Is there a kink or fantasy you've been nervous to admit you want with me?",
    "What's the most turned on I've ever made you — and exactly what did it?",
    "Where outside the bedroom do you secretly want me to take you?",
    "Tonight: slow and teasing until you're begging, or rough and urgent? Why that one?",
    "Is there a toy you'd want to use together — and how would you want me to use it on you?",
    "What would you want me to wear for you, or have me slowly take off you?",
    "Direct every second: describe in detail exactly how you'd want tonight to go.",
    "What's a boundary you're curious to push with me — and how would you want me to start?",
    "When you imagine losing control completely with me, what does that look like?",
    "What's the dirtiest thought you've had about me today?",
    "If I pinned you down right now, what would you want me to do next?",
    "What's something filthy you've wanted to whisper to me but haven't dared?",
    "Where's the most daring place you'd want to risk getting caught with me?",
    "What do you want me to make you beg for?",
    "Name one rule you'd want me to follow in bed tonight — and one you'd want to break.",
    "What would you do to me if you knew no one would ever find out?",
  ],
};

// Each question's id is a stable hash of its TEXT, not its position. That means
// you can freely add, remove, reorder, or move questions between themes and every
// saved answer stays attached to the right question. The one thing that changes a
// question's id is editing its wording — a reworded question is treated as a new
// one (its old answers stay in the bank under the old text but won't reattach).
// FNV-1a, 32-bit → 8 hex chars, prefixed "q" so ids are never bare numbers.
function stableId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "q" + (h >>> 0).toString(16).padStart(8, "0");
}

const Q = [];
const QById = {};
const seenIds = new Set();
for (const [theme, list] of Object.entries(QUESTION_BANK)) {
  for (const text of list) {
    let id = stableId(text);
    while (seenIds.has(id)) id += "x"; // astronomically unlikely hash clash; keep ids unique & deterministic
    seenIds.add(id);
    const q = { id, theme, text };
    Q.push(q);
    QById[id] = q;
  }
}
const TOTAL = Q.length;

// expose to the module-based app
window.THEMES = THEMES;
window.Q = Q;
window.QById = QById;
window.TOTAL = TOTAL;
