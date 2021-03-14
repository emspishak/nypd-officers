/** All information about an officer. */
export interface Officer {
  /** The officer's tax ID (a unique number identifying each officer). */
  readonly taxId: number;
  /** The officer's name. */
  readonly name: Name;
}

/** An officer's name. */
export interface Name {
  /** The officer's first name. */
  readonly first: string;
  /** The officer's middle initial (if present). */
  readonly middleInitial?: string;
  /** The officer's last name. */
  readonly last: string;
}
