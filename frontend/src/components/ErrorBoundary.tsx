import { Component } from "react";
import type { ReactNode } from "react";

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <section role="alert" className="card w-full max-w-lg space-y-4 p-6 text-center">
          <h1 className="text-xl font-bold text-slate-900">L'application a rencontré une erreur</h1>
          <p className="text-sm text-slate-600">Impossible d'afficher cette page. Rechargez l'application pour continuer. Les modifications non enregistrées devront être saisies à nouveau.</p>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>Recharger</button>
        </section>
      </main>
    );
  }
}
