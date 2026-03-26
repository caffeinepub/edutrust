import Array "mo:core/Array";
import Time "mo:core/Time";
import Text "mo:core/Text";
import Int "mo:core/Int";
import Outcall "http-outcalls/outcall";

actor {
  type SearchRecord = {
    name : Text;
    timestamp : Int;
    riskScore : Nat;
    riskLevel : Text;
  };

  type ReportRecord = {
    platformName : Text;
    reason : Text;
    details : Text;
    timestamp : Int;
  };

  type RedditPost = {
    title : Text;
    score : Int;
    subreddit : Text;
    url : Text;
    numComments : Nat;
  };

  var searches : [SearchRecord] = [];
  var reports : [ReportRecord] = [];

  public func saveSearch(name : Text, riskScore : Nat, riskLevel : Text) : async () {
    searches := searches.concat([{
      name = name;
      timestamp = Time.now();
      riskScore = riskScore;
      riskLevel = riskLevel;
    }]);
  };

  public query func getRecentSearches() : async [SearchRecord] {
    let size = searches.size();
    if (size <= 20) return searches;
    searches.sliceToArray(size - 20, size);
  };

  public func submitReport(platformName : Text, reason : Text, details : Text) : async () {
    reports := reports.concat([{
      platformName = platformName;
      reason = reason;
      details = details;
      timestamp = Time.now();
    }]);
  };

  public query func getReports() : async [ReportRecord] {
    reports;
  };

  public query func getReportCount(platformName : Text) : async Nat {
    var count = 0;
    for (r in reports.vals()) {
      if (r.platformName == platformName) count += 1;
    };
    count;
  };

  func encodeQuery(q : Text) : Text {
    var result = "";
    for (c in q.chars()) {
      if (c == ' ') {
        result #= "+";
      } else {
        result #= Text.fromChar(c);
      };
    };
    result;
  };

  func extractBetween(src : Text, prefix : Text, suffix : Text) : Text {
    let iter = src.split(#text prefix);
    ignore iter.next();
    switch (iter.next()) {
      case null { "" };
      case (?after) {
        let iter2 = after.split(#text suffix);
        switch (iter2.next()) {
          case null { "" };
          case (?val) { val };
        };
      };
    };
  };

  func extractJsonText(json : Text, key : Text) : Text {
    extractBetween(json, "\"" # key # "\":\"", "\"");
  };

  func extractJsonNum(json : Text, key : Text) : Int {
    let raw = extractBetween(json, "\"" # key # "\":", ",");
    let trimmed = raw.trim(#char ' ');
    switch (Int.fromText(trimmed)) {
      case null { 0 };
      case (?n) { n };
    };
  };

  public query func transform(raw : Outcall.TransformationInput) : async Outcall.TransformationOutput {
    {
      status = raw.response.status;
      headers = [];
      body = raw.response.body;
    };
  };

  public func fetchRedditReviews(q : Text) : async [RedditPost] {
    let encoded = encodeQuery(q);
    let url = "https://www.reddit.com/search.json?q=" # encoded # "+education&sort=relevance&limit=15&type=link";

    try {
      let bodyText = await Outcall.httpGetRequest(
        url,
        [{ name = "Accept"; value = "application/json" }],
        transform,
      );

      var posts : [RedditPost] = [];
      let chunks = bodyText.split(#text "\"kind\":\"t3\"");
      ignore chunks.next();

      for (chunk in chunks) {
        let title = extractJsonText(chunk, "title");
        let subreddit = extractJsonText(chunk, "subreddit");
        let permalink = extractJsonText(chunk, "permalink");
        let score = extractJsonNum(chunk, "score");
        let numComments = extractJsonNum(chunk, "num_comments");

        if (title != "") {
          let fullUrl = if (permalink != "") {
            "https://www.reddit.com" # permalink;
          } else {
            "https://www.reddit.com/search?q=" # encoded;
          };
          let nc : Nat = if (numComments > 0) { Int.abs(numComments) } else { 0 };
          posts := posts.concat([{
            title = title;
            score = score;
            subreddit = subreddit;
            url = fullUrl;
            numComments = nc;
          }]);
        };
      };

      posts;
    } catch (_) {
      [];
    };
  };
};
