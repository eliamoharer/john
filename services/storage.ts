import { Exercise, WorkoutLog, User, WorkoutSet, AppData, StorageConfig } from '../types.ts';

const STORAGE_KEY = 'ae_tracker_data';
const CONFIG_KEY = 'ae_tracker_config';

const SEED_DATA: AppData = {
  exercises: [
    { id: 'ex_1', name: 'Bench Press', category: 'Chest' },
    { id: 'ex_2', name: 'Squat', category: 'Legs' },
    { id: 'ex_3', name: 'Deadlift', category: 'Back' },
    { id: 'ex_4', name: 'Overhead Press', category: 'Shoulders' },
  ],
  logs: []
};

// FIX: Date Timezone Issue
// Returns YYYY-MM-DD in the user's LOCAL timezone, not UTC
export const getLocalISODate = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const saveConfig = (config: StorageConfig) => {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
};

export const getConfig = (): StorageConfig | null => {
  const s = localStorage.getItem(CONFIG_KEY);
  return s ? JSON.parse(s) : null;
};

let dataCache: AppData | null = null;

const githubRequest = async (endpoint: string, token: string, options: RequestInit = {}) => {
  const res = await fetch(`https://api.github.com/repos/${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`GitHub API Error: ${res.statusText}`);
  return res.json();
};

export const loadData = async (): Promise<AppData> => {
  const config = getConfig();

  if (config && config.githubToken) {
    try {
      // Add timestamp to prevent caching
      const data = await githubRequest(`${config.owner}/${config.repo}/contents/${config.path}?t=${Date.now()}`, config.githubToken, { cache: 'no-store' });
      // GitHub API returns content in base64
      const content = decodeURIComponent(escape(atob(data.content)));
      dataCache = JSON.parse(content);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataCache));
      return dataCache!;
    } catch (e) {
      console.error("Failed to load from GitHub, using local cache", e);
    }
  }

  const local = localStorage.getItem(STORAGE_KEY);
  if (local) {
    dataCache = JSON.parse(local);
    return dataCache!;
  }

  dataCache = SEED_DATA;
  return dataCache!;
};

export const saveData = async (data: AppData): Promise<void> => {
  dataCache = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  const config = getConfig();
  if (config && config.githubToken) {
    try {
      let sha = '';
      try {
        const current = await githubRequest(`${config.owner}/${config.repo}/contents/${config.path}`, config.githubToken);
        sha = current.sha;
      } catch (e) { /* File doesn't exist yet */ }

      // UTF-8 safe base64 encoding
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
      
      await githubRequest(`${config.owner}/${config.repo}/contents/${config.path}`, config.githubToken, {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Update tracker data',
          content: content,
          sha: sha || undefined
        })
      });
    } catch (e) {
      console.error("Sync failed", e);
      alert("Saved locally, but Sync failed. Check Settings.");
    }
  }
};

export const getExercises = async (): Promise<Exercise[]> => {
  const data = await loadData();
  return data.exercises;
};

export const saveExercise = async (exercise: Exercise): Promise<void> => {
  const data = await loadData();
  const idx = data.exercises.findIndex(e => e.id === exercise.id);
  if (idx >= 0) data.exercises[idx] = exercise;
  else data.exercises.push(exercise);
  await saveData(data);
};

export const deleteExercise = async (id: string): Promise<void> => {
  const data = await loadData();
  data.exercises = data.exercises.filter(e => e.id !== id);
  await saveData(data);
};

export const getLogsForExercise = async (exerciseId: string, user: User): Promise<WorkoutLog[]> => {
  const data = await loadData();
  return data.logs
    .filter(l => l.exerciseId === exerciseId && l.user === user)
    .sort((a, b) => b.date.localeCompare(a.date));
};

export const getAllLogsForExercise = async (exerciseId: string): Promise<WorkoutLog[]> => {
  const data = await loadData();
  return data.logs.filter(l => l.exerciseId === exerciseId);
};

export const addSet = async (user: User, exerciseId: string, weight: number, reps: number, dateStr: string): Promise<void> => {
  const data = await loadData();
  let log = data.logs.find(l => l.user === user && l.exerciseId === exerciseId && l.date === dateStr);

  const newSet: WorkoutSet = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    weight,
    reps,
    timestamp: Date.now()
  };

  if (log) {
    log.sets.push(newSet);
  } else {
    log = {
      id: Date.now().toString(),
      exerciseId,
      user,
      date: dateStr,
      sets: [newSet]
    };
    data.logs.push(log);
  }
  await saveData(data);
};

// FIX: Delete Set Logic
export const deleteSet = async (logId: string, setId: string): Promise<void> => {
  const data = await loadData();
  const logIndex = data.logs.findIndex(l => l.id === logId);

  if (logIndex === -1) return;

  // Filter out the specific set
  data.logs[logIndex].sets = data.logs[logIndex].sets.filter(s => s.id !== setId);

  // If the log is now empty, remove the log entirely
  if (data.logs[logIndex].sets.length === 0) {
    data.logs = data.logs.filter(l => l.id !== logId);
  }
  
  await saveData(data);
};