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
  private readonly captures = new Set<Promise<unknown>>();

  mutate<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutationLock.run(operation);
  }

  capture<Prepared, Result>(
    prepare: () => Promise<Prepared>,
    commit: (prepared: Prepared) => Promise<Result>,
  ): Promise<Result> {
    const capture = Promise.resolve()
      .then(prepare)
      .then((prepared) => this.mutationLock.run(() => commit(prepared)));
    this.captures.add(capture);
    void capture.then(
      () => { this.captures.delete(capture); },
      () => { this.captures.delete(capture); },
    );
    return capture;
  }

  async transition<T>(operation: () => Promise<T>): Promise<T> {
    const admittedCaptures = [...this.captures];
    await Promise.allSettled(admittedCaptures);
    return this.mutationLock.run(operation);
  }
}
