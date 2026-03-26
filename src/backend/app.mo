import Array "mo:base/Array";
import Time "mo:base/Time";
import Buffer "mo:base/Buffer";
import Text "mo:base/Text";
import Nat16 "mo:base/Nat16";
import ExperimentalCycles "mo:base/ExperimentalCycles";

actor {
  type SearchRecord = {
    name: Text;
    timestamp: Int;
    riskScore: Nat;
    riskLevel: Text;
  };

  type ReportRecord = {
    platformName: Text;
    reason: Text;
    details: Text;
    timestamp: Int;
  };

  type RedditPost = {
    title: Text;
    score: Int;
    subreddit: Text;
    url: Text;
    numComments: Nat;
  };

  type HttpRequestArgs = {
    url : Text;
    max_response_bytes : ?Nat64;
    headers : [{ name : Text; value : Text }];
    body : ?Blob;
    method : { #get; #post; #head };
    transform : ?{
      function : shared query { response : { status : Nat; headers : [{ name : Text; value : Text }]; body : Blob }; context : Blob } -> async { status : Nat; headers : [{ name : Text; value : Text }]; body : Blob };
      context : Blob;
    };
  };

  type HttpResponsePayload = {
    status : Nat;
    headers : [{ name : Text; value : Text }];
    body : Blob;
  };

  type IC = actor {
    http_request : HttpRequestArgs -> async HttpResponsePayload;
  };

  let ic : IC = actor ("aaaaa-aa");

  var searches : Buffer.Buffer<SearchRecord> = Buffer.Buffer(0);
  var reports : Buffer.Buffer<ReportRecord> = Buffer.Buffer(0);

  public func saveSearch(name: Text, riskScore: Nat, riskLevel: Text) : async () {
    searches.add({
      name = name;
      timestamp = Time.now();
      riskScore = riskScore;
      riskLevel = riskLevel;
    });
  };

  public query func getRecentSearches() : async [SearchRecord] {
    let all = Buffer.toArray(searches);
    let size = all.size();
    if (size <= 20) return all;
    Array.subArray(all, size - 20, 20);
  };

  public func submitReport(platformName: Text, reason: Text, details: Text) : async () {
    reports.add({
      platformName = platformName;
      reason = reason;
      details = details;
      timestamp = Time.now();
    });
  };

  public query func getReports() : async [ReportRecord] {
    Buffer.toArray(reports);
  };

  public query func getReportCount(platformName: Text) : async Nat {
    var count = 0;
    for (r in reports.vals()) {
      if (r.platformName == platformName) count += 1;
    };
    count;
  };

  // Simple URL encode: replace spaces with +, keep alphanumeric and basic chars
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

  // Extract a text value from JSON by key (simple substring search)
  func extractJsonText(json : Text, key : Text) : Text {
    let needle = "\"" # key # "\":\"";
    switch (Text.split(json, #text needle).next()) {
      case null { "" };
      case (?_) {
        let parts = Text.split(json, #text needle);
        ignore parts.next();
        switch (parts.next()) {
          case null { "" };
          case (?after) {
            switch (Text.split(after, #text "\"").next()) {
              case null { "" };
              case (?val) { val };
            };
          };
        };
      };
    };
  };

  // Extract integer value from JSON by key
  func extractJsonInt(json : Text, key : Text) : Int {
    let needle = "\"" # key # ":";
    let parts = Text.split(json, #text needle);
    ignore parts.next();
    switch (parts.next()) {
      case null { 0 };
      case (?after) {
        // take chars until non-digit (allowing leading minus)
        var numStr = "";
        var first = true;
        var done = false;
        for (c in after.chars()) {
          if (not done) {
            if (first and c == '-') {
              numStr #= "-";
              first := false;
            } else if (c >= '0' and c <= '9') {
              numStr #= Text.fromChar(c);
              first := false;
            } else if (not first) {
              done := true;
            } else {
              // skip non-digit prefix chars (e.g. space)
              ();
            };
          };
        };
        switch (Text.toInt(numStr)) {
          case null { 0 };
          case (?n) { n };
        };
      };
    };
  };

  public func fetchRedditReviews(query : Text) : async [RedditPost] {
    let encoded = encodeQuery(query);
    let url = "https://www.reddit.com/search.json?q=" # encoded # "+education&sort=relevance&limit=15&type=link";

    ExperimentalCycles.add(230_850_258_000);

    try {
      let response = await ic.http_request({
        url = url;
        max_response_bytes = ?200_000;
        headers = [
          { name = "User-Agent"; value = "EduTrust/1.0" },
          { name = "Accept"; value = "application/json" },
        ];
        body = null;
        method = #get;
        transform = null;
      });

      if (response.status != 200) {
        return [];
      };

      let bodyText = switch (Text.decodeUtf8(response.body)) {
        case null { return [] };
        case (?t) { t };
      };

      // Parse children from Reddit JSON — split on "kind":"t3" to find posts
      let posts = Buffer.Buffer<RedditPost>(0);
      let chunks = Text.split(bodyText, #text "\"kind\":\"t3\"");
      ignore chunks.next(); // skip header before first post

      for (chunk in chunks) {
        let title = extractJsonText(chunk, "title");
        let subreddit = extractJsonText(chunk, "subreddit");
        let permalink = extractJsonText(chunk, "permalink");
        let score = extractJsonInt(chunk, "score");
        let numComments = extractJsonInt(chunk, "num_comments");

        if (title != "") {
          let fullUrl = if (permalink != "") {
            "https://www.reddit.com" # permalink
          } else {
            "https://www.reddit.com/search?q=" # encoded
          };
          posts.add({
            title = title;
            score = score;
            subreddit = subreddit;
            url = fullUrl;
            numComments = if (numComments >= 0) { Nat16.toNat(Nat16.fromIntWrap(numComments)) } else { 0 };
          });
        };
      };

      Buffer.toArray(posts);
    } catch (_) {
      [];
    };
  };
};
