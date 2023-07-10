import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import {
	SUPABASE_SERVICE_ROLE_KEY,
	SMTP_HOST,
	SMTP_PORT,
	SMTP_AUTH_USER,
	SMTP_AUTH_PASS,
	SMTP_SECURE
} from '$env/static/private';
import { createTransport } from 'nodemailer';

const supabase = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: {
		persistSession: false
	}
});

const auth = {
	user: SMTP_AUTH_USER,
	pass: SMTP_AUTH_PASS
};

export const transporter = createTransport(
	Object.assign(
		{
			host: SMTP_HOST,
			port: SMTP_PORT as unknown as number,
			secure: SMTP_SECURE == 'true' ? true : false
		},
		SMTP_AUTH_USER !== '' ? auth : null
	)
);

export default supabase;
