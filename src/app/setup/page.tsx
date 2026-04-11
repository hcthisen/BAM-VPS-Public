export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { setupAdminAction } from "@/app/actions";
import { Panel } from "@/components/panel";
import { hasAdminUsers } from "@/lib/auth/server";

type SetupPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SetupPage({ searchParams }: SetupPageProps) {
  if (await hasAdminUsers()) {
    redirect("/login");
  }

  const params = searchParams ? await searchParams : {};
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="auth-page">
      <Panel title="Initial Setup" subtitle="Create the first admin account using the one-time VPS setup token.">
        <form action={setupAdminAction} className="form-grid">
          {error ? <p className="form-error">{error}</p> : null}
          <div className="field">
            <label htmlFor="email">Admin email</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Admin password</label>
            <input id="password" name="password" type="password" minLength={8} required />
          </div>
          <div className="field">
            <label htmlFor="setupToken">Setup token</label>
            <input id="setupToken" name="setupToken" type="password" required />
          </div>
          <button className="button" type="submit">
            Create admin
          </button>
        </form>
      </Panel>
    </main>
  );
}
