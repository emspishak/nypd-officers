/** All information about an officer. */
export interface Officer {
  /** The officer's tax ID (a unique number identifying each officer). */
  readonly taxId: number;
  /** The officer's name. */
  readonly name: Name;
  /** The officer's rank. */
  readonly rank: Rank;
  /** The date the officer first joined NYPD. */
  readonly appointmentDate: Date;
  /** The officer's command, e.g. precinct. */
  readonly command: string;
  /** The date the officer was assigned to their current command. */
  readonly assignmentDate: Date;
  /** The officer's ethnicity. */
  readonly ethnicity: Ethnicity;
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

/** An officer's rank, roughly sorted from loweset to highest. */
export enum Rank {
  /** There was an error parsing the rank. */
  ERROR_UNKNOWN = 'ERROR_UNKNOWN',
  POLICE_OFFICER = 'POLICE_OFFICER',
  /** Detective third grade. */
  DETECTIVE_3 = 'DETECTIVE_3',
  /** Detective second grade. */
  DETECTIVE_2 = 'DETECTIVE_2',
  /** Detective first grade. */
  DETECTIVE_1 = 'DETECTIVE_1',
  DETECTIVE_SPECIALIST = 'DETECTIVE_SPECIALIST',
  /** Sergeant special assignment. */
  SERGEANT_SPECIAL = 'SERGEANT_SPECIAL',
  /** Sergeant detective squad. */
  SERGEANT_DET = 'SERGEANT_DET',
  SERGEANT = 'SERGEANT',
  /** Lieutenant detective commander. */
  LIEUTENANT_DET_COMMANDER = 'LIEUTENANT_DET_COMMANDER',
  /** Lieutenant special assignment. */
  LIEUTENANT_SPECIAL = 'LIEUTENANT_SPECIAL',
  LIEUTENANT = 'LIEUTENANT',
  CAPTAIN = 'CAPTAIN',
  DEPUTY_INSPECTOR = 'DEPUTY_INSPECTOR',
  INSPECTOR = 'INSPECTOR',
  DEPUTY_CHIEF = 'DEPUTY_CHIEF',
  ASSISTANT_CHIEF = 'ASSISTANT_CHIEF',
  /** Chief of Community Affairs. */
  CHIEF_COMMUNITY_AFFAIRS = 'CHIEF_COMMUNITY_AFFAIRS',
  /** Chief of Crime Control Strategies. */
  CHIEF_CRIME_CNTRL_STRATEGIES = 'CHIEF_CRIME_CNTRL_STRATEGIES',
  /** Chief of Department. */
  CHIEF_DEPARTMENT = 'CHIEF_DEPARTMENT',
  /** Chief of Detectives. */
  CHIEF_DETECTIVES = 'CHIEF_DETECTIVES',
  /** Chief of Housing. */
  CHIEF_HOUSING = 'CHIEF_HOUSING',
  /** Chief of Intelligence. */
  CHIEF_INTELLIGENCE = 'CHIEF_INTELLIGENCE',
  /** Chief of Labor Relations. */
  CHIEF_LABOR_REL = 'CHIEF_LABOR_REL',
  /** Chief of Operations. */
  CHIEF_OPERATIONS = 'CHIEF_OPERATIONS',
  /** Chief of Patrol. */
  CHIEF_PATROL = 'CHIEF_PATROL',
  /** Chief of Personnel. */
  CHIEF_PERSONNEL = 'CHIEF_PERSONNEL',
  /** Chief of Special Operations. */
  CHIEF_SPECIAL_OPERATIONS = 'CHIEF_SPECIAL_OPERATIONS',
  /** Chief of Training. */
  CHIEF_TRAINING = 'CHIEF_TRAINING',
  /** Chief of Transit. */
  CHIEF_TRANSIT = 'CHIEF_TRANSIT',
  /** Chief of Transportation. */
  CHIEF_TRANSPORTATION = 'CHIEF_TRANSPORTATION',
}

export interface Date {
  readonly year: number;
  readonly month: Month;
  readonly day: number;
}

export enum Month {
  ERROR_UNKNOWN = -1,
  JANUARY = 1,
  FEBRUARY = 2,
  MARCH = 3,
  APRIL = 4,
  MAY = 5,
  JUNE = 6,
  JULY = 7,
  AUGUST = 8,
  SEPTEMBER = 9,
  OCTOBER = 10,
  NOVEMBER = 11,
  DECEMBER = 12,
}

/** NYPD reported ethnicity (these are the only five NYPD provides). */
export enum Ethnicity {
  ERROR_UNKNOWN = 'ERROR_UNKNOWN',
  ASIAN = 'ASIAN',
  BLACK = 'BLACK',
  HISPANIC = 'HISPANIC',
  NATIVE_AMERICAN = 'NATIVE_AMERICAN',
  WHITE = 'WHITE',
}
