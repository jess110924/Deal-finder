import { loginAction } from "./actions";

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const hasError = searchParams.error === "1";

  return (
    <div className="flex flex-col gap-4 w-full max-w-sm mx-auto px-6 py-24">
      <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        Deal Finder
      </h1>
      <form action={loginAction} className="flex flex-col gap-3">
        <input
          type="password"
          name="password"
          placeholder="Password"
          required
          autoFocus
          className="rounded-md px-3 py-2 text-sm"
          style={{ border: "1px solid var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          // Chromium injects its own caret-color into password fields before
          // hydration, which otherwise trips React's hydration-mismatch
          // warning on every load — a known, benign browser/React
          // interaction specific to type="password", not an app bug.
          suppressHydrationWarning
        />
        {hasError && (
          <p className="text-sm" style={{ color: "var(--critical)" }}>
            Incorrect password.
          </p>
        )}
        <button
          type="submit"
          className="rounded-md px-4 py-2.5 font-medium text-white"
          style={{ background: "var(--series-1)" }}
        >
          Log in
        </button>
      </form>
    </div>
  );
}
