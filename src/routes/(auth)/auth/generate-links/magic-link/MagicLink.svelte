<script>
	import { Html, Text, Heading, Link } from 'svelte-email';

	export let siteUrl = '';
	export let tokenHash = '';
</script>

<Html lang="en">
	<Heading as="h2">Magic Link</Heading>

	<Text>Follow this link to login:</Text>
	<Text><Link href="{siteUrl}/auth/magic-link/confirm?token={tokenHash}">Log In</Link></Text>

	<Text
		>The link will remain valid for 24 hours or until it is used, whichever comes first. If you need
		to request another link, <Link href="{siteUrl}/auth/magic-link">please click here</Link>.</Text
	>
</Html>
