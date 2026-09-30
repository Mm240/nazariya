import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const REPLY_LANGUAGES = ['en', 'hi'] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];

export class ChatTurn {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

export class ChatBody {
  /** Earlier turns of this conversation (the browser keeps them; nothing is stored here). */
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ChatTurn)
  history!: ChatTurn[];

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message!: string;

  @IsIn(REPLY_LANGUAGES)
  lang!: ReplyLanguage;
}

export class TranslateBody {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(400, { each: true })
  texts!: string[];

  @IsIn(REPLY_LANGUAGES)
  target!: ReplyLanguage;
}
