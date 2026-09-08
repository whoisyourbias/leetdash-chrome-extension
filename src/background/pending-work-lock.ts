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
  private transitionBarrier: Promise<void> = Promise.resolve();

  mutate<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutationLock.run(operation);
  }

  capture<Prepared, Result>(
    prepare: () => Promise<Prepared>,
    commit: (prepared: Prepared) => Promise<Result>,
  ): Promise<Result> {
    const precedingTransition = this.transitionBarrier;
    const capture = Promise.resolve()
      .then(prepare)
      .then(async (prepared) => {
        await precedingTransition;
        return this.mutationLock.run(() => commit(prepared));
      });
    this.captures.add(capture);
    void capture.then(
      () => { this.captures.delete(capture); },
      () => { this.captures.delete(capture); },
    );
    return capture;
  }

  transition<T>(operation: () => Promise<T>): Promise<T> {
    const admittedCaptures = [...this.captures];
    const precedingTransition = this.transitionBarrier;
    let releaseTransition!: () => void;
    this.transitionBarrier = new Promise<void>((resolve) => {
      releaseTransition = resolve;
    });
    return (async () => {
      try {
        await precedingTransition;
        await Promise.allSettled(admittedCaptures);
        return await this.mutationLock.run(operation);
      } finally {
        releaseTransition();
      }
    })();
  }
}
