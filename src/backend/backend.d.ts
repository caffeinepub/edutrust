export interface SearchRecord {
  name: string;
  timestamp: bigint;
  riskScore: bigint;
  riskLevel: string;
}

export interface ReportRecord {
  platformName: string;
  reason: string;
  details: string;
  timestamp: bigint;
}

export interface RedditPost {
  title: string;
  score: bigint;
  subreddit: string;
  url: string;
  numComments: bigint;
}

export interface Backend {
  saveSearch(name: string, riskScore: bigint, riskLevel: string): Promise<void>;
  getRecentSearches(): Promise<SearchRecord[]>;
  submitReport(platformName: string, reason: string, details: string): Promise<void>;
  getReports(): Promise<ReportRecord[]>;
  getReportCount(platformName: string): Promise<bigint>;
  fetchRedditReviews(query: string): Promise<RedditPost[]>;
}
