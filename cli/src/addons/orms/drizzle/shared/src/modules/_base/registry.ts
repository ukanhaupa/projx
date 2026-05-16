export interface RegisteredEntity {
  name: string;
  apiPrefix: string;
}

const entityList: RegisteredEntity[] = [];

export function registerInRegistry(entry: RegisteredEntity): void {
  if (entityList.some((existing) => existing.name === entry.name)) return;
  entityList.push(entry);
}

export function listEntities(): RegisteredEntity[] {
  return [...entityList].sort((a, b) => a.name.localeCompare(b.name));
}
