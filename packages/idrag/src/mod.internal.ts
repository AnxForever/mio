export const modManager = {
  get activeMod() { return 'boyfriend'; },
  getModPath(name: string) { return `./mods/${name}`; },
};
