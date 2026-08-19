import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import type { LoginDto, RefreshDto, RegisterDto } from './auth.service';

/**
 * Este controller NO tiene rutas HTTP. Los handlers con @MessagePattern
 * escuchan mensajes TCP enviados por el ClientProxy del gateway
 * (client.send('auth.login', ...)). auth-ms es invisible para el mundo
 * exterior — el gateway es la única puerta de entrada al sistema.
 */
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @MessagePattern('auth.register')
  register(@Payload() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @MessagePattern('auth.login')
  login(@Payload() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @MessagePattern('auth.refresh')
  refresh(@Payload() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @MessagePattern('auth.logout')
  logout(@Payload() dto: RefreshDto) {
    return this.auth.logout(dto);
  }
}
