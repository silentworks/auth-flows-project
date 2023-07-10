<script>
	import { Html, Text, Heading, Link } from 'svelte-email';

	export let siteUrl = '';
	export let tokenHash = '';
</script>

<Html lang="en">
	<Heading as="h2">Password Reset</Heading>

	<Text
		>We're sorry to hear that you're having trouble accessing your account. To reset your password
		and regain access, please click the link below:</Text
	>

	<Text
		><Link href="{siteUrl}/auth/forgotpassword/confirm?token={tokenHash}">Reset Password</Link
		></Text
	>

	<Text
		>Once you've clicked the link, you'll be prompted to enter a new password for your account.
		Please choose a strong, unique password that you haven't used before, and make sure to remember
		it for future logins.</Text
	>

	<Text
		>If you did not request a password reset, please ignore this message and do not click the link.
		Your account security is important to us, and we take all necessary steps to protect it.</Text
	>
</Html>
