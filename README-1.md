``` typescript

@HttpEndpoint('GET', '/api/users/:id', {
  payload: GetUserByIdPayloadSchema,
  metadata: GetUserByIdMetadataSchema,
  response: UserResponseSchema,
})
class GetUserById {
  async handle(
    payload: GetUserByIdPayloadSchema,
    metadata: GetUserByIdMetadataSchema,
  ): Promise<ResponseContext<UserResponseSchema>> {
    // payload и metadata - типы проверяются компилятором!
    const user = {
      id: payload.id,
      name: `User ${payload.id}`,
      email: `user${payload.id}@example.com`,
      ...(payload.include === 'profile' && {
        profile: { bio: `Bio for user ${payload.id}` },
      }),
      ...(payload.include === 'posts' && {
        posts: [
          { id: 1, title: `Post 1 by user ${payload.id}` },
          { id: 2, title: `Post 2 by user ${payload.id}` },
        ],
      }),
    };

    return {
      status: 200,
      value: user,
      meta: {
        authenticated: !!metadata.authorization,
      },
    };
  }
}