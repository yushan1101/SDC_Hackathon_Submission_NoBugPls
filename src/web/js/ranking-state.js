// Presentation state only: keep the backend's order, scores and stable ESCO role IDs.
export const scenarioName = (scenario) => scenario === "agentic" ? "Agentive AI" : "Assistive AI";
export const rankScore = (value) => Number.isFinite(value) ? value.toFixed(3) : "–";

export function rankMovements(previous, current) {
  const positions = new Map(previous.map((role, index) => [role.soc, index + 1]));
  return new Map(current.map((role, index) => {
    const from = positions.get(role.soc), to = index + 1, delta = from == null ? null : from - to;
    return [role.soc, { from, to, delta, kind: !previous.length ? "initial" : from == null ? "new" : delta > 0 ? "up" : delta < 0 ? "down" : "same" }];
  }));
}

// Scoped to one assessment view. Changes to skills/answers use a different key;
// entries expire so a later comparison can pick up a newer daily trend board.
export function createScenarioCache({ ttl = 120000, now = Date.now } = {}) {
  const saved = new Map(), pending = new Map();
  const keyFor = (input, scenario) => JSON.stringify([input, scenario]);
  return {
    seed(input, scenario, data) { saved.set(keyFor(input, scenario), { data, until: now() + ttl }); },
    async get(input, scenario, load) {
      const key = keyFor(input, scenario), hit = saved.get(key);
      if (hit && hit.until > now()) return hit.data;
      if (pending.has(key)) return pending.get(key);
      const task = Promise.resolve(load()).then((data) => {
        saved.set(key, { data, until: now() + ttl }); return data;
      }).finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    },
  };
}
