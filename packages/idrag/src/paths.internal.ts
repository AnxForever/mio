let _paths = { personaGraph: './data/persona-graph.json' };
export function setPaths(p: typeof _paths) { _paths = p; }
export const personaGraphPath = (d?: string) => _paths.personaGraph;
export const modSoulPath = (name: string) => `./mods/${name}/soul.md`;
