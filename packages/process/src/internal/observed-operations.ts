interface OperationRecord {
  observed: boolean;
  rejected: boolean;
  complete: boolean;
  cause?: unknown;
  settled: Promise<void>;
}

/** Keeps normal Promise chaining while detecting a dropped, rejected operation. */
class ObservedPromise<T> extends Promise<T> {
  static override get [Symbol.species](): PromiseConstructor { return Promise; }

  constructor(source: Promise<T>, private readonly record: OperationRecord, private readonly release: () => void) {
    super((resolve, reject) => { void source.then(resolve, reject); });
    record.settled = super.then(() => { record.complete = true; release(); }, (cause: unknown) => {
      record.rejected = true;
      record.cause = cause;
      record.complete = true;
      release();
    });
  }

  /** await and normal chaining consume this operation; derived promises behave normally. */
  // This Promise subclass must override then to observe normal await/chaining consumption.
  // oxlint-disable-next-line unicorn/no-thenable
  override then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.record.observed = true;
    this.release();
    return super.then(onfulfilled, onrejected);
  }
}

/** Records only owned operations; caller-created Promise chains keep native semantics. */
export class ObservedOperations {
  private readonly records = new Set<OperationRecord>();

  /** Wraps a public result without treating internal cleanup as caller observation. */
  wrap<T>(operation: Promise<T>): Promise<T> {
    const record: OperationRecord = { observed: false, rejected: false, complete: false, settled: Promise.resolve() };
    this.records.add(record);
    return new ObservedPromise(operation, record, () => {
      if (record.complete && (record.observed || !record.rejected)) this.records.delete(record);
    });
  }

  /** Joins owned results before reporting rejections no caller awaited or chained. */
  async failures(): Promise<unknown[]> {
    await Promise.all([...this.records].map(record => record.settled));
    return [...this.records].filter(record => record.rejected && !record.observed).map(record => record.cause);
  }
}
