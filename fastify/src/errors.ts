export class NotFoundError extends Error {
  public readonly modelName: string;
  public readonly resourceId: string;

  constructor(modelName: string, id: string) {
    super(`${modelName} not found with id ${id}`);
    this.modelName = modelName;
    this.resourceId = id;
    this.name = 'NotFoundError';
  }
}

export class BusinessRuleError extends Error {
  public readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.detail = detail;
    this.name = 'BusinessRuleError';
  }
}
