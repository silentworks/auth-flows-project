import { SupabaseClient, Session } from '@supabase/supabase-js';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient;
			getSession(): Promise<Session | null>;
		}
		interface PageData {
			session: Session | null;
			flash?: { type: 'success' | 'error'; message: string };
		}
		// interface Error {}
		// interface Platform {}
	}
}
