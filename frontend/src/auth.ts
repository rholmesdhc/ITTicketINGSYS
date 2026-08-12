import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// NextAuth/Auth.js handles the Microsoft OAuth redirect dance. It is NOT
// our application's session mechanism - once it succeeds, the login page's
// bridge hook exchanges the Graph-scoped access token captured here for
// our own local JWT (via backend POST /auth/entra) and stores that in
// localStorage, same as the legacy username/password login always did.
// Every other page in the app only ever reads that local JWT; NextAuth's
// own session is only consulted during this one handshake.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
      authorization: {
        params: {
          // GroupMember.Read.All is what lets the backend resolve role
          // from Entra security group membership - see entra_auth.py.
          scope: "openid profile email offline_access User.Read GroupMember.Read.All",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Only present on the initial sign-in response, not subsequent
      // token refreshes - that's fine, the bridge hook only needs it once.
      if (account?.access_token) {
        token.graphAccessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      return { ...session, graphAccessToken: token.graphAccessToken as string | undefined };
    },
  },
});
