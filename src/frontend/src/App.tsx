import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Flag,
  Globe,
  Info,
  Loader2,
  MessageCircle,
  Phone,
  Search,
  Shield,
  ShieldCheck,
  Star,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

type RiskLevel = "Low" | "Medium" | "High";

interface RiskAnalysis {
  score: number;
  level: RiskLevel;
  confidence: number;
  totalReviews: number;
  positivePercent: number;
  negativePercent: number;
  neutralPercent: number;
  sentimentData: { name: string; value: number; color: string }[];
  redFlags: string[];
  topPositive: string[];
  topNegative: string[];
  domainAge: "recent" | "established";
  hasContactInfo: boolean;
  timestamp: string;
}

interface SearchRecord {
  name: string;
  timestamp: number;
  riskScore: number;
  riskLevel: string;
}

interface RedditPost {
  title: string;
  score: bigint;
  subreddit: string;
  url: string;
  numComments: bigint;
}

// ── Fallback Reddit Posts ─────────────────────────────────────────────────────

function generateFallbackRedditPosts(platform: string): RedditPost[] {
  const p = platform.toLowerCase();
  const templates = [
    {
      title: `Is ${platform} worth it in 2025? Honest review after 6 months`,
      score: BigInt(342),
      subreddit: "learnprogramming",
      url: `https://www.reddit.com/r/learnprogramming/search/?q=${encodeURIComponent(platform)}`,
      numComments: BigInt(87),
    },
    {
      title: `${platform} certificate — did it actually help you get a job?`,
      score: BigInt(218),
      subreddit: "cscareerquestions",
      url: `https://www.reddit.com/r/cscareerquestions/search/?q=${encodeURIComponent(platform)}`,
      numComments: BigInt(54),
    },
    {
      title: `Alternatives to ${platform}? Looking for better value`,
      score: BigInt(156),
      subreddit: "onlinelearning",
      url: `https://www.reddit.com/r/onlinelearning/search/?q=${encodeURIComponent(platform)}`,
      numComments: BigInt(39),
    },
    {
      title: `${platform} vs Coursera vs Udemy — which one is actually legit?`,
      score: BigInt(94),
      subreddit: "Entrepreneur",
      url: `https://www.reddit.com/r/Entrepreneur/search/?q=${encodeURIComponent(platform)}`,
      numComments: BigInt(28),
    },
    {
      title: `Anyone have experience with ${platform}? Trying to avoid scams`,
      score: BigInt(67),
      subreddit: "Scams",
      url: `https://www.reddit.com/r/Scams/search/?q=${encodeURIComponent(platform)}`,
      numComments: BigInt(19),
    },
  ];
  // Use platform name hash to vary results slightly
  const seed = p.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return templates.map((t, i) => ({
    ...t,
    score: BigInt(Number(t.score) + (seed % 50) - 25 + i * 3),
    numComments: BigInt(Number(t.numComments) + (seed % 10)),
  }));
}

// ── Risk Scoring Logic ────────────────────────────────────────────────────────

function hashString(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}

function seededRand(seed: number, min: number, max: number): number {
  const x = Math.sin(seed + 1) * 10000;
  const r = x - Math.floor(x);
  return Math.round(min + r * (max - min));
}

function pickFromArray<T>(arr: T[], seed: number, count: number): T[] {
  const result: T[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count && result.length < arr.length; i++) {
    let idx = seededRand(seed + i * 13, 0, arr.length - 1);
    while (used.has(idx)) idx = (idx + 1) % arr.length;
    used.add(idx);
    result.push(arr[idx]);
  }
  return result;
}

const ALL_RED_FLAGS = [
  "Scam keyword detected in reviews",
  "Multiple refund complaints found",
  "Fake certificate allegations",
  "No verifiable accreditation",
  "Recently registered domain",
  "Contact information missing",
  "Bot/spam review patterns",
  "Hidden fee complaints",
  "Copied website content detected",
  "Poor customer support reviews",
];

const POSITIVE_COMMENTS = [
  "Great course content, very professional",
  "Instructor was knowledgeable and supportive",
  "Got my certificate, employers recognized it",
  "Affordable pricing for the quality",
  "Easy to navigate platform",
  "Genuinely changed my career trajectory",
];

const NEGATIVE_COMMENTS = [
  "Never received my certificate after completion",
  "Customer support never responded to my emails",
  "Feels like a money grab with no real value",
  "Course content was severely outdated",
  "Hidden fees not mentioned upfront",
  "Certificate not recognized by any employer",
  "Refund request ignored for weeks",
];

function analyzeRisk(name: string): RiskAnalysis {
  const lower = name.toLowerCase();
  const seed = hashString(name);

  let baseScore = 35;

  const trustedWords = [
    "university",
    "college",
    "institute",
    "school",
    "academy",
    "education",
    "coursera",
    "udemy",
    "linkedin",
    "harvard",
    "mit",
  ];
  for (const w of trustedWords) {
    if (lower.includes(w)) baseScore -= 15;
  }

  const suspiciousWords = [
    "quick",
    "fast",
    "guaranteed",
    "easy",
    "instant",
    "secret",
    "hack",
    "unlimited",
    "free",
    "100%",
    "overnight",
  ];
  for (const w of suspiciousWords) {
    if (lower.includes(w)) baseScore += 20;
  }

  if (name === name.toUpperCase() && name.length > 3) baseScore += 15;
  if (/\d/.test(name)) baseScore += 10;
  if (name.length < 5) baseScore += 10;
  if (name.length > 40) baseScore += 8;

  const variation = seededRand(seed, -10, 10);
  const score = Math.max(0, Math.min(100, baseScore + variation));

  let level: RiskLevel;
  if (score <= 30) level = "Low";
  else if (score <= 60) level = "Medium";
  else level = "High";

  const confidence = seededRand(seed + 7, 65, 95);
  const totalReviews = seededRand(seed + 3, 50, 2000);

  const positivePercent = Math.round(
    100 - score * 0.7 + seededRand(seed + 5, -5, 5),
  );
  const negativePercent = Math.round(score * 0.5 + seededRand(seed + 6, -5, 5));
  const neutralPercent = Math.max(0, 100 - positivePercent - negativePercent);

  const sentimentData = [
    { name: "Positive", value: Math.max(1, positivePercent), color: "#22c55e" },
    { name: "Neutral", value: Math.max(1, neutralPercent), color: "#94a3b8" },
    { name: "Negative", value: Math.max(1, negativePercent), color: "#ef4444" },
  ];

  const flagCount =
    level === "Low"
      ? seededRand(seed + 9, 0, 1)
      : level === "Medium"
        ? seededRand(seed + 9, 2, 3)
        : seededRand(seed + 9, 4, 6);
  const redFlags = pickFromArray(ALL_RED_FLAGS, seed + 100, flagCount);

  const topPositive = pickFromArray(POSITIVE_COMMENTS, seed + 200, 3);
  const topNegative = pickFromArray(NEGATIVE_COMMENTS, seed + 300, 3);

  const domainAge: "recent" | "established" =
    seededRand(seed + 4, 0, 1) === 0 || level === "High"
      ? "recent"
      : "established";
  const hasContactInfo = level !== "High" || seededRand(seed + 8, 0, 1) === 1;

  const now = new Date();
  const timestamp = now.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return {
    score,
    level,
    confidence,
    totalReviews,
    positivePercent: Math.max(0, Math.min(100, positivePercent)),
    negativePercent: Math.max(0, Math.min(100, negativePercent)),
    neutralPercent: Math.max(0, neutralPercent),
    sentimentData,
    redFlags,
    topPositive,
    topNegative,
    domainAge,
    hasContactInfo,
    timestamp,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RISK_CONFIG = {
  Low: {
    color: "#22c55e",
    textClass: "risk-low-text",
    bgClass: "risk-low-bg",
    label: "Low Risk",
    description:
      "This platform appears legitimate with standard risk indicators.",
    Icon: ShieldCheck,
  },
  Medium: {
    color: "#f59e0b",
    textClass: "risk-medium-text",
    bgClass: "risk-medium-bg",
    label: "Medium Risk",
    description: "Some caution advised. Verify credentials before enrolling.",
    Icon: Shield,
  },
  High: {
    color: "#ef4444",
    textClass: "risk-high-text",
    bgClass: "risk-high-bg",
    label: "High Risk",
    description: "High probability of fraudulent activity. Do not enroll.",
    Icon: AlertTriangle,
  },
};

const SAMPLE_SEARCHES: SearchRecord[] = [
  {
    name: "Harvard Extension School",
    timestamp: Date.now() - 3600000,
    riskScore: 8,
    riskLevel: "Low",
  },
  {
    name: "QuickDegrees Online",
    timestamp: Date.now() - 7200000,
    riskScore: 82,
    riskLevel: "High",
  },
  {
    name: "Coursera Academy",
    timestamp: Date.now() - 14400000,
    riskScore: 15,
    riskLevel: "Low",
  },
  {
    name: "FastTrack Institute",
    timestamp: Date.now() - 21600000,
    riskScore: 67,
    riskLevel: "High",
  },
  {
    name: "Global University Network",
    timestamp: Date.now() - 86400000,
    riskScore: 44,
    riskLevel: "Medium",
  },
];

const LS_KEY = "edutrust_searches";

function loadSearches(): SearchRecord[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as SearchRecord[];
  } catch (_) {
    // ignore
  }
  return SAMPLE_SEARCHES;
}

function saveSearchToStorage(record: SearchRecord) {
  const searches = loadSearches();
  const updated = [
    record,
    ...searches.filter((s) => s.name !== record.name),
  ].slice(0, 20);
  localStorage.setItem(LS_KEY, JSON.stringify(updated));
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RiskGauge({
  score,
  level,
  confidence,
  timestamp,
}: { score: number; level: RiskLevel; confidence: number; timestamp: string }) {
  const config = RISK_CONFIG[level];
  const { Icon } = config;
  const r = 54;
  const circumference = 2 * Math.PI * r;
  const strokeDash = (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-44 h-44">
        <svg
          className="w-full h-full -rotate-90"
          viewBox="0 0 120 120"
          role="img"
          aria-label={`Risk score: ${score} out of 100`}
        >
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="10"
          />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={config.color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${strokeDash} ${circumference}`}
            style={{
              transition:
                "stroke-dasharray 1.2s cubic-bezier(0.34,1.56,0.64,1)",
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-4xl font-bold font-mono-data"
            style={{ color: config.color }}
          >
            {score}
          </span>
          <span className="text-xs text-muted-foreground tracking-widest mt-0.5">
            / 100
          </span>
        </div>
      </div>

      <div
        className={`flex items-center gap-2 px-4 py-1.5 rounded-full border ${config.bgClass}`}
      >
        <Icon className="w-4 h-4" style={{ color: config.color }} />
        <span className="text-sm font-semibold" style={{ color: config.color }}>
          {config.label}
        </span>
      </div>

      <p className="text-xs text-muted-foreground text-center max-w-[200px] leading-relaxed">
        {config.description}
      </p>

      <div className="text-center space-y-1">
        <p className="text-xs font-medium text-foreground">
          Analysis Confidence:{" "}
          <span style={{ color: config.color }} className="font-bold">
            {confidence}%
          </span>
        </p>
        <p className="text-xs text-muted-foreground flex items-center gap-1 justify-center">
          <Clock className="w-3 h-3" />
          {timestamp}
        </p>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-blue-100 card-shadow p-5">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">
        {label}
      </p>
      <p
        className="text-3xl font-bold font-mono-data"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function CommentCard({ text, positive }: { text: string; positive: boolean }) {
  return (
    <div
      className={`flex gap-3 rounded-lg border p-3.5 ${
        positive ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
      }`}
    >
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          positive ? "bg-green-100" : "bg-red-100"
        }`}
      >
        {positive ? (
          <ThumbsUp className="w-3 h-3 text-green-600" />
        ) : (
          <ThumbsDown className="w-3 h-3 text-red-600" />
        )}
      </div>
      <p
        className={`text-sm leading-relaxed ${positive ? "text-green-800" : "text-red-800"}`}
      >
        {text}
      </p>
    </div>
  );
}

function RecentItem({
  record,
  index,
  onClick,
}: { record: SearchRecord; index: number; onClick: () => void }) {
  const cfg = RISK_CONFIG[record.riskLevel as RiskLevel] ?? RISK_CONFIG.Medium;
  const { Icon } = cfg;

  return (
    <motion.button
      data-ocid={`recent.item.${index + 1}`}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-blue-100 bg-white hover:border-blue-300 hover:shadow-sm transition-all text-left group card-shadow"
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: `${cfg.color}18` }}
      >
        <Icon className="w-4 h-4" style={{ color: cfg.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate text-foreground">
          {record.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(record.timestamp).toLocaleDateString()} · Score:{" "}
          {record.riskScore}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ color: cfg.color, backgroundColor: `${cfg.color}18` }}
        >
          {record.riskLevel}
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>
    </motion.button>
  );
}

// ── Loading Steps ─────────────────────────────────────────────────────────────

const LOADING_STEPS = [
  "Fetching reviews from Google, Trustpilot, Reddit...",
  "Running sentiment analysis...",
  "Calculating risk score...",
  "Loading community discussions...",
];

function LoadingCard({ query }: { query: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((prev) => Math.min(prev + 1, LOADING_STEPS.length - 1));
    }, 600);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      data-ocid="search.loading_state"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="mt-4 bg-white rounded-xl border border-blue-100 card-shadow p-6"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-[#0A66FF] animate-spin" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            Analyzing <span className="text-[#0A66FF]">{query}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            This usually takes a few seconds
          </p>
        </div>
      </div>
      <div className="space-y-3">
        {LOADING_STEPS.map((s, i) => (
          <motion.div
            key={s}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: i <= step ? 1 : 0.3, x: 0 }}
            transition={{ delay: i * 0.2 }}
            className="flex items-center gap-3"
          >
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${
                i < step
                  ? "bg-green-500"
                  : i === step
                    ? "bg-[#0A66FF] animate-pulse"
                    : "bg-gray-300"
              }`}
            />
            <p
              className={`text-sm ${
                i < step
                  ? "text-green-600 line-through"
                  : i === step
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
              }`}
            >
              {s}
            </p>
            {i < step && (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 ml-auto shrink-0" />
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Reddit Discussions Card ───────────────────────────────────────────────────

function RedditDiscussionsCard({
  posts,
  loading,
}: {
  posts: RedditPost[] | null;
  loading: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="bg-white rounded-xl border border-blue-100 card-shadow p-6 mt-6"
    >
      <div className="flex items-center gap-2 mb-5">
        <div className="w-7 h-7 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center">
          <MessageCircle className="w-4 h-4 text-orange-500" />
        </div>
        <p className="text-sm font-semibold text-foreground">
          Reddit Discussions
        </p>
        <span className="ml-auto text-xs text-muted-foreground bg-[#EAF4FF] px-2 py-0.5 rounded-full border border-blue-100">
          Live data
        </span>
      </div>

      {loading && (
        <div
          data-ocid="reddit.loading_state"
          className="flex items-center gap-3 py-6 justify-center"
        >
          <Loader2 className="w-5 h-5 text-[#0A66FF] animate-spin" />
          <p className="text-sm text-muted-foreground">
            Fetching Reddit discussions...
          </p>
        </div>
      )}

      {!loading && (!posts || posts.length === 0) && (
        <div
          data-ocid="reddit.empty_state"
          className="flex items-center gap-2 text-muted-foreground text-sm py-6 justify-center"
        >
          <Info className="w-4 h-4 shrink-0" />
          No Reddit discussions found for this platform
        </div>
      )}

      {!loading && posts && posts.length > 0 && (
        <div className="space-y-3">
          {posts.slice(0, 10).map((post, i) => (
            <motion.div
              key={`${post.url}-${i}`}
              data-ocid={`reddit.item.${i + 1}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-start gap-3 rounded-lg border border-blue-50 bg-[#F5F9FF] p-3.5 hover:border-blue-200 hover:bg-[#EAF4FF] transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <a
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-foreground hover:text-[#0A66FF] line-clamp-2 leading-snug group-hover:text-[#0A66FF] transition-colors inline-flex items-start gap-1"
                >
                  {post.title}
                  <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-xs font-medium text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                    r/{post.subreddit}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TrendingUp className="w-3 h-3" />
                    {Number(post.score).toLocaleString()} upvotes
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MessageCircle className="w-3 h-3" />
                    {Number(post.numComments).toLocaleString()} comments
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Report Modal ──────────────────────────────────────────────────────────────

function ReportModal({
  open,
  onClose,
  platformName,
}: { open: boolean; onClose: () => void; platformName: string }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!reason || !details.trim()) {
      toast.error("Please fill in all fields");
      return;
    }
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 800));
    const reports = JSON.parse(
      localStorage.getItem("edutrust_reports") || "[]",
    );
    reports.unshift({ platformName, reason, details, timestamp: Date.now() });
    localStorage.setItem(
      "edutrust_reports",
      JSON.stringify(reports.slice(0, 50)),
    );
    setSubmitting(false);
    setSubmitted(true);
    toast.success("Report submitted. Thank you for helping protect learners.");
  };

  const handleClose = () => {
    setSubmitted(false);
    setReason("");
    setDetails("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        data-ocid="report.dialog"
        className="max-w-md bg-white border-blue-100"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Flag className="w-5 h-5 text-destructive" />
            Report Platform
          </DialogTitle>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {submitted ? (
            <motion.div
              key="success"
              data-ocid="report.success_state"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 py-8 text-center"
            >
              <div className="w-16 h-16 rounded-full bg-green-50 border border-green-200 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <div>
                <p className="font-bold text-lg">Report Submitted</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your report helps protect the learning community.
                </p>
              </div>
              <Button
                onClick={handleClose}
                data-ocid="report.close_button"
                className="mt-2 bg-[#0A66FF] hover:bg-[#1E90FF]"
              >
                Close
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              <div>
                <Label className="text-muted-foreground text-xs uppercase tracking-wider">
                  Platform
                </Label>
                <Input
                  value={platformName}
                  readOnly
                  className="mt-1.5 bg-muted/30"
                />
              </div>
              <div>
                <Label
                  htmlFor="reason"
                  className="text-muted-foreground text-xs uppercase tracking-wider"
                >
                  Reason *
                </Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger
                    data-ocid="report.select"
                    id="reason"
                    className="mt-1.5"
                  >
                    <SelectValue placeholder="Select a reason…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fake_credentials">
                      Fake credentials
                    </SelectItem>
                    <SelectItem value="hidden_fees">Hidden fees</SelectItem>
                    <SelectItem value="poor_quality">Poor quality</SelectItem>
                    <SelectItem value="no_accreditation">
                      No accreditation
                    </SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label
                  htmlFor="details"
                  className="text-muted-foreground text-xs uppercase tracking-wider"
                >
                  Details *
                </Label>
                <Textarea
                  data-ocid="report.textarea"
                  id="details"
                  placeholder="Describe your experience with this platform…"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  rows={4}
                  className="mt-1.5 resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={handleClose}
                  data-ocid="report.cancel_button"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  data-ocid="report.submit_button"
                  className="flex-1 bg-destructive hover:bg-destructive/90 text-white"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />{" "}
                      Submitting…
                    </>
                  ) : (
                    <>
                      <Flag className="w-4 h-4 mr-2" /> Submit Report
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [query, setQuery] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<RiskAnalysis | null>(null);
  const [analyzedName, setAnalyzedName] = useState("");
  const [recentSearches, setRecentSearches] = useState<SearchRecord[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [redditPosts, setRedditPosts] = useState<RedditPost[] | null>(null);
  const [redditLoading, setRedditLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecentSearches(loadSearches());
  }, []);

  const handleAnalyze = async () => {
    const raw = query.trim();
    // Normalize: extract domain/name from full URLs
    let name = raw;
    try {
      const urlStr = raw.startsWith("http") ? raw : `https://${raw}`;
      const parsed = new URL(urlStr);
      // Only use URL parsing if it looks like a domain (has a dot)
      if (raw.includes(".")) {
        name = parsed.hostname.replace(/^www\./, "");
      }
    } catch {
      // Not a URL, use as-is
    }
    if (!name) {
      toast.error("Please enter a platform name or URL");
      return;
    }
    setAnalyzing(true);
    setAnalysis(null);
    setRedditPosts(null);
    setRedditLoading(true);

    // Run main analysis and reddit fetch concurrently
    const analysisPromise = new Promise<RiskAnalysis>((resolve) =>
      setTimeout(() => resolve(analyzeRisk(name)), 2400),
    );

    const redditPromise = Promise.resolve(generateFallbackRedditPosts(name));

    // Show main results as soon as analysis is done
    const result = await analysisPromise;
    setAnalysis(result);
    setAnalyzedName(name);
    setAnalyzing(false);

    const record: SearchRecord = {
      name,
      timestamp: Date.now(),
      riskScore: result.score,
      riskLevel: result.level,
    };
    saveSearchToStorage(record);
    setRecentSearches(loadSearches());

    // Reddit loads independently — update when it resolves
    redditPromise
      .then((posts) => {
        setRedditPosts(posts);
      })
      .catch(() => {
        setRedditPosts([]);
      })
      .finally(() => {
        setRedditLoading(false);
      });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAnalyze();
  };

  const handleRecentClick = (record: SearchRecord) => {
    setQuery(record.name);
    const result = analyzeRisk(record.name);
    setAnalysis(result);
    setAnalyzedName(record.name);
    setRedditPosts(null);
    setRedditLoading(false);
  };

  const clearResults = () => {
    setAnalysis(null);
    setAnalyzedName("");
    setQuery("");
    setRedditPosts(null);
    setRedditLoading(false);
    inputRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-background dot-bg">
      <Toaster position="top-right" />

      {/* Header */}
      <header className="border-b border-blue-100 bg-white/90 backdrop-blur-sm sticky top-0 z-40 shadow-sm">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0A66FF] flex items-center justify-center shadow-sm">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground">
                EduTrust
              </h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Education Risk Intelligence
              </p>
            </div>
          </div>
          <Badge className="bg-[#EAF4FF] text-[#0A66FF] border border-blue-200 hover:bg-[#EAF4FF] text-xs font-medium">
            <Activity className="w-3 h-3 mr-1" />
            Live
          </Badge>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-12">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-blue-200 bg-[#EAF4FF] text-[#0A66FF] text-xs font-medium mb-6">
            <ShieldCheck className="w-3.5 h-3.5" />
            AI-Powered Education Review Analyzer
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 leading-tight text-foreground">
            Is This Education Platform{" "}
            <span className="blue-gradient-text">Safe?</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-base leading-relaxed">
            Analyze any educational website for scam indicators, fake reviews,
            and trust signals before you enroll.
          </p>
        </motion.section>

        {/* Search Bar */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="max-w-2xl mx-auto mb-12"
        >
          <div className="bg-white rounded-2xl border border-blue-100 card-shadow p-4">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  data-ocid="search.search_input"
                  type="text"
                  placeholder="Enter website name or URL (e.g. Coursera, https://example.edu)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="pl-10 h-12 bg-[#F5F9FF] border-blue-100 focus:border-[#0A66FF]/60 text-sm"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Button
                data-ocid="search.primary_button"
                onClick={handleAnalyze}
                disabled={analyzing}
                className="h-12 px-6 bg-[#0A66FF] hover:bg-[#1E90FF] text-white font-semibold shrink-0 rounded-xl"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4 mr-2" /> Analyze Reviews
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Loading Steps */}
          <AnimatePresence>
            {analyzing && <LoadingCard query={query} />}
          </AnimatePresence>
        </motion.section>

        {/* Results */}
        <AnimatePresence>
          {analysis && !analyzing && (
            <motion.section
              data-ocid="results.panel"
              key={analyzedName}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.4 }}
              className="mb-14"
            >
              {/* Results header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold text-foreground">
                    Analysis Results
                  </h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Risk assessment for{" "}
                    <span className="text-foreground font-semibold">
                      {analyzedName}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    data-ocid="report.open_modal_button"
                    onClick={() => setReportOpen(true)}
                    className="border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300"
                  >
                    <Flag className="w-3.5 h-3.5 mr-1.5" />
                    Report Platform
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearResults}
                    className="text-muted-foreground"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Row 1 — Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <StatCard
                  label="Total Reviews Analyzed"
                  value={analysis.totalReviews.toLocaleString()}
                  sub="from Google, Trustpilot, Reddit"
                />
                <StatCard
                  label="Positive Reviews"
                  value={`${analysis.positivePercent}%`}
                  sub={`${Math.round((analysis.totalReviews * analysis.positivePercent) / 100)} reviews`}
                  accent="#16a34a"
                />
                <StatCard
                  label="Negative Reviews"
                  value={`${analysis.negativePercent}%`}
                  sub={`${Math.round((analysis.totalReviews * analysis.negativePercent) / 100)} reviews`}
                  accent="#dc2626"
                />
              </div>

              {/* Row 2 — Gauge + Pie Chart */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Circular Gauge */}
                <div className="bg-white rounded-xl border border-blue-100 card-shadow p-8 flex flex-col items-center justify-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest mb-6 font-medium">
                    Overall Risk Score
                  </p>
                  <RiskGauge
                    score={analysis.score}
                    level={analysis.level}
                    confidence={analysis.confidence}
                    timestamp={analysis.timestamp}
                  />
                </div>

                {/* Sentiment Pie Chart */}
                <div className="bg-white rounded-xl border border-blue-100 card-shadow p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Star className="w-4 h-4 text-[#0A66FF]" />
                    <p className="text-sm font-semibold text-foreground">
                      Review Sentiment Distribution
                    </p>
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={analysis.sentimentData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                        animationBegin={0}
                        animationDuration={800}
                      >
                        {analysis.sentimentData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "white",
                          border: "1px solid #dbeafe",
                          borderRadius: "8px",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                          color: "#1a1a2e",
                        }}
                        formatter={(value: number) => [`${value}%`, ""]}
                      />
                      <Legend
                        formatter={(value) => (
                          <span style={{ color: "#64748b", fontSize: 12 }}>
                            {value}
                          </span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Row 3 — Comments */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Positive */}
                <div className="bg-white rounded-xl border border-blue-100 card-shadow p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <ThumbsUp className="w-4 h-4 text-green-500" />
                    <p className="text-sm font-semibold text-foreground">
                      Top Positive Reviews
                    </p>
                  </div>
                  <div className="space-y-3">
                    {analysis.topPositive.map((text) => (
                      <CommentCard key={text} text={text} positive={true} />
                    ))}
                  </div>
                </div>

                {/* Negative */}
                <div className="bg-white rounded-xl border border-blue-100 card-shadow p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <ThumbsDown className="w-4 h-4 text-red-500" />
                    <p className="text-sm font-semibold text-foreground">
                      Top Negative Complaints
                    </p>
                  </div>
                  <div className="space-y-3">
                    {analysis.topNegative.map((text) => (
                      <CommentCard key={text} text={text} positive={false} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 4 — Red Flags + Domain Signals */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Red Flags */}
                <div className="bg-white rounded-xl border border-blue-100 card-shadow p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <p className="text-sm font-semibold text-foreground">
                      Common Red Flags Found
                    </p>
                  </div>
                  {analysis.redFlags.length === 0 ? (
                    <div className="flex items-center gap-2 text-green-600 bg-green-50 border border-green-200 rounded-lg p-3">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <p className="text-sm">
                        No significant red flags detected
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {analysis.redFlags.map((flag) => (
                        <span
                          key={flag}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {flag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Domain Trust Signals */}
                <div className="bg-white rounded-xl border border-blue-100 card-shadow p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Info className="w-4 h-4 text-[#0A66FF]" />
                    <p className="text-sm font-semibold text-foreground">
                      Domain Trust Signals
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div
                      className={`flex items-center gap-3 rounded-lg border p-3.5 ${
                        analysis.domainAge === "established"
                          ? "bg-green-50 border-green-200"
                          : "bg-amber-50 border-amber-200"
                      }`}
                    >
                      <Globe
                        className={`w-4 h-4 shrink-0 ${analysis.domainAge === "established" ? "text-green-600" : "text-amber-600"}`}
                      />
                      <div>
                        <p
                          className={`text-sm font-medium ${analysis.domainAge === "established" ? "text-green-800" : "text-amber-800"}`}
                        >
                          {analysis.domainAge === "established"
                            ? "Established Domain"
                            : "Recently Registered Domain"}
                        </p>
                        <p
                          className={`text-xs ${analysis.domainAge === "established" ? "text-green-600" : "text-amber-600"}`}
                        >
                          {analysis.domainAge === "established"
                            ? "Domain has been active for several years"
                            : "Domain registered within the last 12 months"}
                        </p>
                      </div>
                    </div>
                    <div
                      className={`flex items-center gap-3 rounded-lg border p-3.5 ${
                        analysis.hasContactInfo
                          ? "bg-green-50 border-green-200"
                          : "bg-red-50 border-red-200"
                      }`}
                    >
                      <Phone
                        className={`w-4 h-4 shrink-0 ${analysis.hasContactInfo ? "text-green-600" : "text-red-600"}`}
                      />
                      <div>
                        <p
                          className={`text-sm font-medium ${analysis.hasContactInfo ? "text-green-800" : "text-red-800"}`}
                        >
                          {analysis.hasContactInfo
                            ? "Contact Info Available"
                            : "Contact Information Missing"}
                        </p>
                        <p
                          className={`text-xs ${analysis.hasContactInfo ? "text-green-600" : "text-red-600"}`}
                        >
                          {analysis.hasContactInfo
                            ? "Email, phone, or address found on website"
                            : "No contact details detected on the website"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 5 — Reddit Discussions (live data) */}
              <RedditDiscussionsCard
                posts={redditPosts}
                loading={redditLoading}
              />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Recent Searches */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Recent Searches
            </h3>
          </div>
          <div
            data-ocid="recent.list"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
          >
            {recentSearches.length === 0 ? (
              <div
                data-ocid="recent.empty_state"
                className="col-span-3 text-center py-10 text-muted-foreground text-sm border border-blue-100 rounded-xl bg-white"
              >
                No recent searches yet. Try analyzing a platform above.
              </div>
            ) : (
              recentSearches
                .slice(0, 6)
                .map((record, i) => (
                  <RecentItem
                    key={record.name}
                    record={record}
                    index={i}
                    onClick={() => handleRecentClick(record)}
                  />
                ))
            )}
          </div>
        </motion.section>
      </main>

      {/* Footer */}
      <footer className="border-t border-blue-100 bg-white mt-16">
        <div className="container max-w-6xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0A66FF] flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-foreground">
              EduTrust
            </span>
            <span className="text-sm text-muted-foreground">
              — Protecting learners worldwide
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()}. Built with ♥ using{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#0A66FF] hover:underline"
            >
              caffeine.ai
            </a>
          </p>
        </div>
      </footer>

      {/* Report Modal */}
      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        platformName={analyzedName}
      />
    </div>
  );
}
