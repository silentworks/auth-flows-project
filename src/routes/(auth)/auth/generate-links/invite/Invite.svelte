<script>
	import { Html, Text, Heading, Link } from 'svelte-email';

	export let siteUrl = '';
	export let tokenHash = '';
</script>

<Html lang="en">
	<Heading as="h2">You have been invited to the Email Test Project</Heading>

	<Text>
		You have been invited to create a user on {siteUrl}. Follow this link to accept the invite:
	</Text>
	<Text><Link href="{siteUrl}/auth/invite/confirm?token={tokenHash}">Accept the invite</Link></Text>
</Html>
