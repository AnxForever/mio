export function modManager() {
  return {
    get activeMod() { return 'female'; },
    getModPath(name: string) { return `./mods/${name}`; },
  };
}
