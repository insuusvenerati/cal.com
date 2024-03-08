import { EventTypesService } from "@/ee/event-types/services/event-types.service";
import { TokensRepository } from "@/modules/tokens/tokens.repository";
import { CreateUserInput } from "@/modules/users/inputs/create-user.input";
import { UsersRepository } from "@/modules/users/users.repository";
import { Injectable } from "@nestjs/common";
import * as crypto from "crypto";

import { createNewUsersConnectToOrgIfExists } from "@calcom/platform-libraries";

@Injectable()
export class OAuthClientUsersService {
  constructor(
    private readonly userRepository: UsersRepository,
    private readonly tokensRepository: TokensRepository,
    private readonly eventTypesService: EventTypesService
  ) {}

  async createOauthClientUser(oAuthClientId: string, body: CreateUserInput, organizationId?: number) {
    if (!organizationId) {
      const username = generateShortHash(body.email, oAuthClientId);
      const user = await this.userRepository.create(body, username, oAuthClientId);
      const { accessToken, refreshToken } = await this.tokensRepository.createOAuthTokens(
        oAuthClientId,
        user.id
      );
      await this.eventTypesService.createUserDefaultEventTypes(user.id);

      return {
        user,
        tokens: {
          accessToken,
          refreshToken,
        },
      };
    } else {
      const [emailUser, emailDomain] = body.email.split("@");
      const orgUser = (
        await createNewUsersConnectToOrgIfExists({
          usernamesOrEmails: [body.email],
          input: {
            teamId: organizationId,
            role: "MEMBER",
            usernameOrEmail: [body.email],
            isOrg: true,
            language: "en",
          },
          parentId: null,
          autoAcceptEmailDomain: emailDomain,
          connectionInfoMap: {
            [body.email]: {
              orgId: organizationId,
              autoAccept: true,
            },
          },
        })
      )[0];
      await this.userRepository.addToOAuthClient(orgUser.id, oAuthClientId);
      const { accessToken, refreshToken } = await this.tokensRepository.createOAuthTokens(
        oAuthClientId,
        orgUser.id
      );
      await this.eventTypesService.createUserDefaultEventTypes(orgUser.id);

      return {
        user: orgUser,
        tokens: {
          accessToken,
          refreshToken,
        },
      };
    }
  }
}

function generateShortHash(email: string, clientId: string): string {
  // Get the current timestamp
  const timestamp = Date.now().toString();

  // Concatenate the timestamp and email
  const data = timestamp + email + clientId;

  // Create a SHA256 hash
  const hash = crypto
    .createHash("sha256")
    .update(data)
    .digest("base64")
    .replace("=", "")
    .replace("/", "")
    .replace("+", "");

  return hash.toLowerCase();
}