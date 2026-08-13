export interface MarcContributor {
  readonly name: string;
  readonly role?: string;
}

export interface MarcSeries {
  readonly name: string;
  readonly volume?: string;
}

export interface CatalogMetadata {
  readonly audience?: string;
  readonly juvenileHeading: boolean;
  readonly subjects: readonly string[];
  readonly genres: readonly string[];
  readonly contributors: readonly MarcContributor[];
  readonly pageCount?: number;
  readonly callNumber?: string;
  readonly summary?: string;
  readonly series: readonly MarcSeries[];
}
