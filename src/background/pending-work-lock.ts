export class PendingWorkLock {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export class PendingWorkCoordinator {
  private readonly mutationLock = new PendingWorkLock();
  private readonly captureLock = new PendingWorkLock();

  mutate<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutationLock.run(operation);
  }

  capture<Prepared, Result>(
    prepare: () => Promise<Prepared>,
    commit: (prepared: Prepared) => Promise<Result>,
  ): Promise<Result> {
    return this.captureLock.run(async () => {
      const prepared = await prepare();
      return this.mutationLock.run(() => commit(prepared));
    });
  }

  transition<T>(operation: () => Promise<T>): Promise<T> {
    return this.captureLock.run(() => this.mutationLock.run(operation));
  }
}
