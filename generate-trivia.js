#!/usr/bin/env node
/**
 * Murphy Trivia Generator
 *
 * Generates a trivia game for a family member using Claude API.
 * Reads their answers from Firebase, gathers wrong answers from
 * other family members, and creates multiple-choice questions.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   node generate-trivia.js <familyMemberId>
 *
 * Example:
 *   node generate-trivia.js leo
 */

const FIREBASE_URL = 'https://trivia-655b7-default-rtdb.firebaseio.com';

async function fbGet(path) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`);
  return res.json();
}

async function fbSet(path, data) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

// About-you question bank (must match index.html)
const ABOUT_QUESTIONS = [
  { id: 0, question: "Where were you born?" },
  { id: 1, question: "What was your favorite food from childhood?" },
  { id: 2, question: "What was your favorite game as a kid?" },
  { id: 3, question: "Did you have a childhood nickname? What was it?" },
  { id: 4, question: "What was your favorite subject in school?" },
  { id: 5, question: "Who was your best friend growing up?" },
  { id: 6, question: "What did you want to be when you grew up?" },
  { id: 7, question: "What was your favorite toy from childhood?" },
  { id: 8, question: "What was your favorite book from childhood?" },
  { id: 9, question: "Did you have any pets growing up? What were their names?" },
  { id: 10, question: "What was your favorite cartoon as a kid?" },
  { id: 11, question: "What was the name of your elementary school?" },
  { id: 12, question: "Who was your favorite teacher growing up?" },
  { id: 13, question: "What was your favorite after-school activity or club?" },
  { id: 14, question: "Who in your family are you most like, and why?" },
  { id: 15, question: "What's your favorite family vacation memory?" },
  { id: 16, question: "What's a dish that reminds you of home?" },
  { id: 17, question: "Who in your family makes the best food, and what dish do they make?" },
  { id: 18, question: "What's your all-time favorite movie?" },
  { id: 19, question: "What's a song that always makes you happy?" },
  { id: 20, question: "What's your favorite book?" },
  { id: 21, question: "What's your comfort food?" },
  { id: 22, question: "What's your favorite TV show?" },
  { id: 23, question: "What's your favorite dessert?" },
  { id: 24, question: "What's your favorite smell?" },
  { id: 25, question: "What was the first concert you ever attended?" },
  { id: 26, question: "If you could only use one app on your phone for a week, which would it be?" },
  { id: 27, question: "What is your guilty pleasure movie or TV show?" },
  { id: 28, question: "What's your favorite animal?" },
  { id: 29, question: "What food could you eat every day and never get tired of?" },
  { id: 30, question: "What's a food you absolutely can't stand?" },
  { id: 31, question: "What's your go-to order at a restaurant?" },
  { id: 32, question: "If you had to pick a final meal, what would be on the plate?" },
  { id: 33, question: "Where in the world would you most like to go?" },
  { id: 34, question: "What's your favorite place you've visited?" },
  { id: 35, question: "Have you ever lived in another city or country?" },
  { id: 36, question: "What was your very first job?" },
  { id: 37, question: "What do you do for work, and do you enjoy it?" },
  { id: 38, question: "Did you go to college? Where did you go?" },
  { id: 39, question: "What's something you know a lot about that might surprise people?" },
  { id: 40, question: "What's a job you had that people might be surprised by?" },
  { id: 41, question: "What's a weird habit or quirk you have?" },
  { id: 42, question: "What are you irrationally afraid of?" },
  { id: 43, question: "Do you collect anything? What and why?" },
  { id: 44, question: "What's something small that annoys you more than it should?" },
  { id: 45, question: "What's a minor pet peeve that drives you irrationally crazy?" },
  { id: 46, question: "What hobby could you talk about for hours?" },
  { id: 47, question: "Are you into sports? Which ones — playing or watching?" },
  { id: 48, question: "What's a talent or skill you have that most people don't know about?" },
  { id: 49, question: "Do you play any musical instruments?" },
  { id: 50, question: "What's a hobby you picked up as an adult?" },
  { id: 51, question: "What game (board game, video game, card game) do you love?" },
  { id: 52, question: "What's your go-to karaoke song?" },
  { id: 53, question: "What's a movie you've watched more than any other?" },
];

async function gatherAnswers(memberId) {
  // Get self-answers (find user with this familyMemberId)
  const allUsers = await fbGet('users');
  let selfAnswers = {};
  let memberName = memberId;

  for (const [uid, u] of Object.entries(allUsers || {})) {
    if (u.familyMemberId === memberId) {
      memberName = u.name || memberId;
      if (u.aboutAnswers) {
        for (const [qId, data] of Object.entries(u.aboutAnswers)) {
          const answer = typeof data === 'object' ? data.answer : data;
          selfAnswers[qId] = answer;
        }
      }
      break;
    }
  }

  // Get family answers about them
  const familyAnswers = await fbGet(`familyAnswers/${memberId}`);
  const famAnswers = {};
  if (familyAnswers) {
    for (const [qId, answerers] of Object.entries(familyAnswers)) {
      for (const [uid, entry] of Object.entries(answerers)) {
        const answer = typeof entry === 'object' ? entry.answer : entry;
        if (!famAnswers[qId]) famAnswers[qId] = [];
        famAnswers[qId].push(answer);
      }
    }
  }

  // Merge: prefer self-answer, fall back to first family answer
  const merged = {};
  const allQIds = new Set([...Object.keys(selfAnswers), ...Object.keys(famAnswers)]);
  for (const qId of allQIds) {
    const q = ABOUT_QUESTIONS.find(aq => aq.id === Number(qId));
    if (!q) continue;
    merged[qId] = {
      question: q.question,
      answer: selfAnswers[qId] || (famAnswers[qId] ? famAnswers[qId][0] : null),
    };
  }

  return { memberName, answers: merged };
}

async function gatherWrongAnswers(memberId) {
  // Collect other family members' answers to use as wrong options
  const allUsers = await fbGet('users');
  const otherAnswers = {}; // qId -> [answer1, answer2, ...]

  for (const [uid, u] of Object.entries(allUsers || {})) {
    if (u.familyMemberId === memberId) continue; // skip the target
    if (!u.aboutAnswers) continue;
    for (const [qId, data] of Object.entries(u.aboutAnswers)) {
      const answer = typeof data === 'object' ? data.answer : data;
      if (!otherAnswers[qId]) otherAnswers[qId] = [];
      otherAnswers[qId].push(answer);
    }
  }

  return otherAnswers;
}

async function generateWithClaude(memberName, answers, wrongAnswerPool, funFacts) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  const firstName = memberName.split(' ')[0];

  // Build the prompt
  const answerList = Object.entries(answers)
    .map(([qId, data]) => `- Question: "${data.question}"\n  Answer: "${data.answer}"`)
    .join('\n');

  const wrongAnswerText = Object.entries(wrongAnswerPool)
    .filter(([qId]) => answers[qId])
    .map(([qId, wrongs]) => {
      const q = ABOUT_QUESTIONS.find(aq => aq.id === Number(qId));
      return `- For "${q?.question}": other family members answered: ${wrongs.map(w => `"${w}"`).join(', ')}`;
    })
    .join('\n');

  const funFactText = funFacts.length > 0
    ? `\nFun facts submitted about ${firstName}:\n${funFacts.map(f => `- "${f.fact}" (from ${f.submittedBy})`).join('\n')}`
    : '';

  const prompt = `Generate a trivia game about ${memberName} for their family to play.

Here are the answers we've collected about ${firstName}:
${answerList}
${funFactText}

Other family members' answers (use these as plausible wrong answers when they fit):
${wrongAnswerText}

Generate 20-25 multiple-choice trivia questions. For each question:
1. Write a fun question about ${firstName} based on their answers
2. The correct answer should be based on what they actually said
3. Include 3 wrong answers — prefer using other family members' real answers when available (they make the best wrong answers!). When no family answers fit, make up funny/plausible alternatives
4. Add a fun fact or witty comment for each question
5. Keep the tone playful and family-friendly — like a fun game night

Return ONLY a JSON array of objects with this exact format (no markdown, no explanation):
[
  {
    "category": "Category Name",
    "question": "The trivia question?",
    "choices": ["Wrong 1", "Correct Answer", "Wrong 2", "Wrong 3"],
    "answer": 1,
    "funFact": "A fun fact or comment about the answer."
  }
]

The "answer" field is the 0-based index of the correct choice in the "choices" array. Randomize where the correct answer appears (don't always put it in the same position).`;

  console.log(`Calling Claude API to generate ${firstName} Trivia...`);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (data.error) {
    console.error('Claude API error:', data.error);
    process.exit(1);
  }

  const text = data.content[0].text.trim();
  // Parse JSON — handle potential markdown code blocks
  const jsonStr = text.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
  return JSON.parse(jsonStr);
}

async function main() {
  const memberId = process.argv[2];
  if (!memberId) {
    console.error('Usage: node generate-trivia.js <familyMemberId>');
    console.error('Example: node generate-trivia.js leo');
    process.exit(1);
  }

  console.log(`Generating trivia for: ${memberId}`);

  // Gather data
  const { memberName, answers } = await gatherAnswers(memberId);
  console.log(`Found ${Object.keys(answers).length} answers for ${memberName}`);

  if (Object.keys(answers).length < 5) {
    console.error(`Not enough answers (${Object.keys(answers).length}). Need at least 5.`);
    process.exit(1);
  }

  const wrongAnswerPool = await gatherWrongAnswers(memberId);
  console.log(`Gathered wrong answer pool from ${Object.keys(wrongAnswerPool).length} questions`);

  // Get fun facts
  const funFactsData = await fbGet(`funFacts/${memberId}`);
  const funFacts = funFactsData
    ? Object.values(funFactsData).map(f => ({ fact: f.fact, submittedBy: f.submittedBy || '?' }))
    : [];
  if (funFacts.length > 0) {
    console.log(`Found ${funFacts.length} fun facts`);
  }

  // Generate with Claude
  const questions = await generateWithClaude(memberName, answers, wrongAnswerPool, funFacts);
  console.log(`Generated ${questions.length} trivia questions`);

  // Validate
  for (const q of questions) {
    if (!q.category || !q.question || !q.choices || q.answer === undefined || !q.funFact) {
      console.error('Invalid question format:', q);
      process.exit(1);
    }
    if (q.choices.length !== 4) {
      console.error('Question must have exactly 4 choices:', q.question);
      process.exit(1);
    }
    if (q.answer < 0 || q.answer > 3) {
      console.error('Answer index out of range:', q.question);
      process.exit(1);
    }
  }

  // Save to Firebase
  await fbSet(`generatedGames/${memberId}`, {
    name: memberName,
    questions,
    generatedAt: Date.now(),
  });

  console.log(`\nSuccess! ${memberName} Trivia saved to Firebase.`);
  console.log(`${questions.length} questions ready to play.`);
  console.log(`\nSample question:`);
  const sample = questions[0];
  console.log(`  ${sample.question}`);
  sample.choices.forEach((c, i) => {
    console.log(`  ${i === sample.answer ? '✓' : ' '} ${['A', 'B', 'C', 'D'][i]}. ${c}`);
  });
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
