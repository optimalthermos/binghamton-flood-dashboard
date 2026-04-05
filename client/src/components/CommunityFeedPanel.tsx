import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MessageSquare, ExternalLink, ChevronDown, ChevronUp, ImageOff } from "lucide-react";
import type { CommunityFeed, CommunityPost } from "@shared/schema";

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function PostItem({ post }: { post: CommunityPost }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className={`flex items-start gap-3 p-2.5 rounded-lg border transition-colors ${
        post.isFloodRelated
          ? "bg-blue-500/10 border-blue-500/20"
          : "bg-muted/20 border-border"
      }`}
    >
      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 mb-1">
          <p className="text-sm font-medium leading-snug line-clamp-2 flex-1">{post.title}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 shrink-0"
          >
            r/{post.subreddit}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{formatTimeAgo(post.date)}</span>
          <span className="text-[11px] text-muted-foreground/70">{post.anonymizedAuthor}</span>
          {post.isFloodRelated && (
            <Badge className="text-[10px] px-1.5 py-0 h-4 bg-blue-500/20 text-blue-300 border-blue-500/30 shrink-0">
              flood
            </Badge>
          )}
        </div>
      </div>

      {/* Right side: image thumbnail + link */}
      <div className="flex items-center gap-1.5 shrink-0">
        {post.hasImage && post.imageUrl && !imgError && (
          <div className="w-12 h-12 rounded overflow-hidden border border-border bg-muted/30 shrink-0">
            <img
              src={post.imageUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          </div>
        )}
        {post.hasImage && post.imageUrl && imgError && (
          <div className="w-12 h-12 rounded border border-border bg-muted/30 flex items-center justify-center shrink-0">
            <ImageOff className="h-4 w-4 text-muted-foreground/50" />
          </div>
        )}
        <a
          href={post.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-primary transition-colors p-1"
          title="Open Reddit post"
          onClick={e => e.stopPropagation()}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

interface CommunityFeedPanelProps {
  feedData: CommunityFeed | undefined;
  isLoading: boolean;
}

export function CommunityFeedPanel({ feedData, isLoading }: CommunityFeedPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const MAX_VISIBLE = 10;

  const posts = feedData?.posts?.slice(0, MAX_VISIBLE) || [];
  const floodCount = feedData?.floodPostCount || 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              Community Reports
              {floodCount > 0 && (
                <Badge className="ml-1 text-[10px] px-1.5 py-0 h-4 bg-blue-500/20 text-blue-300 border-blue-500/30">
                  {floodCount} flood-related
                </Badge>
              )}
            </CardTitle>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                {isOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 rounded-lg bg-muted/30 animate-pulse" />
                ))}
              </div>
            ) : posts.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                No community posts available
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {posts.map((post, i) => (
                    <PostItem key={`${post.link}-${i}`} post={post} />
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <a
                    href="https://www.reddit.com/r/binghamton/new/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    View more on Reddit
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {feedData?.lastUpdated && (
                    <span className="text-[11px] text-muted-foreground/60">
                      Updated {formatTimeAgo(feedData.lastUpdated)}
                    </span>
                  )}
                </div>

                <p className="mt-2 text-[10px] text-muted-foreground/50 leading-snug">
                  Aggregated from public Reddit feeds. Names anonymized.
                </p>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
