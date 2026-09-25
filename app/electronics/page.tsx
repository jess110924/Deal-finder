import ElectronicsSearch from "@/components/ElectronicsSearch";
import CardFavorites from "@/components/CardFavorites";

export default function ElectronicsPage() {
  return (
    <div className="flex flex-col gap-10 w-full max-w-3xl mx-auto px-6 py-8">
      <ElectronicsSearch />
      <hr style={{ borderColor: "var(--border-hairline)" }} />
      <CardFavorites />
    </div>
  );
}
