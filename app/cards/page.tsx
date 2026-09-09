import CardSearch from "@/components/CardSearch";
import PlayerSearch from "@/components/PlayerSearch";
import CardWatchlist from "@/components/CardWatchlist";

export default function CardsPage() {
  return (
    <div className="flex flex-col gap-10 w-full max-w-3xl mx-auto px-6 py-8">
      <CardSearch />
      <hr style={{ borderColor: "var(--border-hairline)" }} />
      <PlayerSearch />
      <hr style={{ borderColor: "var(--border-hairline)" }} />
      <CardWatchlist />
    </div>
  );
}
