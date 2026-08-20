/* Activity categories. Order matters — the first keyword match wins, so the
   specific ones sit above the generic ones ("AI training" must beat "training"). */
'use strict';

const CATEGORIES = [
  { id: 'ai',       name: 'AI',        icon: '🤖', color: '#7c3aed',
    kw: ['ai', 'ml', 'llm', 'machine learning', 'model', 'fine tune', 'finetune', 'dataset',
         'neural', 'claude', 'gpt', 'chatgpt', 'prompt', 'ai training', 'agent'] },

  { id: 'youtube',  name: 'YouTube',   icon: '🎬', color: '#e5342a',
    kw: ['youtube', 'yt', 'video', 'upload', 'thumbnail', 'edit', 'render', 'footage',
         'voiceover', 'voice over', 'vo', 'script', 'film', 'record', 'channel',
         'capcut', 'remotion', 'premiere', 'shorts', 'b roll', 'broll'] },

  { id: 'study',    name: 'Study',     icon: '📚', color: '#4c5fd7',
    kw: ['study', 'revise', 'revision', 'exam', 'lecture', 'course', 'class', 'assignment',
         'homework', 'notes', 'learn', 'anki', 'textbook', 'module', 'quiz', 'mcq', 'flashcard'] },

  { id: 'gym',      name: 'Gym',       icon: '🏋️', color: '#ea580c',
    kw: ['gym', 'workout', 'work out', 'exercise', 'lift', 'weight', 'cardio', 'run', 'jog',
         'swim', 'football', 'sport', 'training', 'stretch', 'squat', 'press up', 'push up',
         'yoga', 'boxing', 'cycle'] },

  { id: 'code',     name: 'Code',      icon: '💻', color: '#0d9488',
    kw: ['code', 'coding', 'program', 'dev', 'debug', 'deploy', 'app', 'website', 'git',
         'api', 'refactor', 'bug', 'ship', 'feature'] },

  { id: 'health',   name: 'Health',    icon: '🩺', color: '#dc2626',
    kw: ['doctor', 'hospital', 'clinic', 'dentist', 'medic', 'therapy', 'pharmacy',
         'medication', 'gp', 'check up', 'checkup', 'scan', 'blood test'] },

  { id: 'faith',    name: 'Faith',     icon: '🙏', color: '#9333ea',
    kw: ['pray', 'prayer', 'church', 'mass', 'bible', 'devotion', 'mosque', 'meditate',
         'meditation', 'mindfulness', 'quiet time', 'worship'] },

  { id: 'meal',     name: 'Meal',      icon: '🍽️', color: '#f97316',
    kw: ['eat', 'meal', 'breakfast', 'lunch', 'dinner', 'cook', 'food', 'snack', 'brunch',
         'supper'] },

  { id: 'sleep',    name: 'Sleep',     icon: '😴', color: '#4338ca',
    kw: ['sleep', 'nap', 'bed', 'wake', 'lie down', 'wind down'] },

  { id: 'travel',   name: 'Travel',    icon: '🚗', color: '#2563eb',
    kw: ['travel', 'drive', 'commute', 'flight', 'fly', 'train', 'bus', 'airport',
         'journey', 'uber', 'taxi', 'pick up', 'drop off'] },

  { id: 'social',   name: 'Social',    icon: '👥', color: '#e11d48',
    kw: ['family', 'friend', 'party', 'date', 'visit', 'hangout', 'hang out', 'wedding',
         'birthday', 'mum', 'dad', 'brother', 'sister', 'chat'] },

  { id: 'meeting',  name: 'Meeting',   icon: '📞', color: '#0891b2',
    kw: ['meeting', 'meet', 'call', 'zoom', 'interview', 'standup', 'catch up', 'sync',
         'appointment', 'consult'] },

  { id: 'money',    name: 'Money',     icon: '💰', color: '#15803d',
    kw: ['money', 'budget', 'finance', 'invest', 'salary', 'pay', 'savings', 'invoice',
         'tax', 'bill', 'bank', 'rent'] },

  { id: 'admin',    name: 'Admin',     icon: '✉️', color: '#64748b',
    kw: ['email', 'admin', 'paperwork', 'form', 'inbox', 'sort out', 'organise', 'organize',
         'reply', 'application', 'visa', 'document'] },

  { id: 'read',     name: 'Reading',   icon: '📖', color: '#b45309',
    kw: ['read', 'book', 'article', 'chapter', 'novel', 'paper'] },

  { id: 'write',    name: 'Writing',   icon: '✍️', color: '#a16207',
    kw: ['write', 'writing', 'journal', 'blog', 'essay', 'draft', 'notes app'] },

  { id: 'shopping', name: 'Shopping',  icon: '🛒', color: '#db2777',
    kw: ['shop', 'shopping', 'groceries', 'grocery', 'market', 'buy', 'order', 'mall'] },

  { id: 'chores',   name: 'Chores',    icon: '🧹', color: '#78716c',
    kw: ['clean', 'laundry', 'wash', 'tidy', 'chore', 'dishes', 'bin', 'iron', 'hoover'] },

  { id: 'break',    name: 'Break',     icon: '☕', color: '#059669',
    kw: ['break', 'coffee', 'tea', 'relax', 'chill', 'walk', 'pause', 'downtime', 'rest'] },

  { id: 'music',    name: 'Music',     icon: '🎵', color: '#c026d3',
    kw: ['music', 'guitar', 'piano', 'sing', 'instrument', 'beat', 'song'] },

  { id: 'work',     name: 'Work',      icon: '💼', color: '#3b6ea5',
    kw: ['work', 'job', 'shift', 'office', 'client', 'deadline', 'report', 'presentation',
         'project', 'task'] },

  { id: 'other',    name: 'Other',     icon: '📌', color: '#6366f1', kw: [] }
];

const DEFAULT_CATEGORY = CATEGORIES[CATEGORIES.length - 1];

/* Short keywords need a closing boundary ("ai" must not match "air"), longer ones
   are left open so "study" also catches "studying". */
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

CATEGORIES.forEach(c => {
  if (!c.kw.length) { c.rx = null; return; }
  const parts = c.kw.map(k => '\\b' + escapeRx(k) + (k.length <= 3 ? '\\b' : ''));
  c.rx = new RegExp('(' + parts.join('|') + ')', 'i');
});

function categoryOf(title) {
  const s = String(title || '');
  for (const c of CATEGORIES) if (c.rx && c.rx.test(s)) return c;
  return DEFAULT_CATEGORY;
}

const categoryById = id => CATEGORIES.find(c => c.id === id) || DEFAULT_CATEGORY;

/* A task's look: explicit overrides win, otherwise it follows the detected category. */
function styleOf(task) {
  const cat = task.cat ? categoryById(task.cat) : categoryOf(task.title);
  return {
    cat: cat,
    icon: task.icon || cat.icon,
    color: task.color || cat.color
  };
}
