<script>
	import { Html, Text, Heading, Link } from 'svelte-email';

	export let siteUrl = '';
	export let tokenHash = '';
</script>

<Html lang="en">
	<Heading as="h2">Sign up confirmation</Heading>

	<Text>
		Thank you for signing up! To complete the registration process and gain access to our platform,
		please click the link below to confirm your account:
	</Text>

	<Text
		><Link href="{siteUrl}/auth/magic-link/confirm?token={tokenHash}">Confirm your mail</Link></Text
	>

	<Text>
		This confirmation step is important to ensure that we have accurate and up-to-date information
		for all our users. Once you have confirmed your account, you will be logged in and you can start
		using our services.
	</Text>

	<Text>Thank you for choosing our platform. We look forward to serving you.</Text>
</Html>
