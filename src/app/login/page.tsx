export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { loginAdminAction } from "@/app/actions";
import { Panel } from "@/components/panel";
import { hasAdminUsers } from "@/lib/auth/server";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (!(await hasAdminUsers())) {
    redirect("/setup");
  }

  const params = searchParams ? await searchParams : {};
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="auth-page">
      <Panel title="Admin Login" subtitle="Sign in to the BAM control plane.">
        <form action={loginAdminAction} className="form-grid">
          {error ? <p className="form-error">{error}</p> : null}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required />
          </div>
          <button className="button" type="submit">
            Sign in
          </button>
        </form>
      </Panel>
    </main>
  );
}
