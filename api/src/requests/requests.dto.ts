import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RequestCategory, RequestStatus, ServiceRequest } from './service-request.entity.js';
import { StatusHistory } from './status-history.entity.js';

// Validators run bottom-up and stop at the first failure, so the type check goes last.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateRequestDto {
  @IsEnum(RequestCategory)
  category: RequestCategory;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @MaxLength(50)
  @IsNotEmpty()
  @IsString()
  orderNumber: string;

  @Transform(trim)
  @MaxLength(2000)
  @IsNotEmpty()
  @IsString()
  description: string;
}

export class PaginationQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @Type(() => Number)
  @Min(1)
  @IsInt()
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @Max(100)
  @Min(1)
  @IsInt()
  pageSize = 20;
}

export class ListRequestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;

  @IsOptional()
  @IsEnum(RequestCategory)
  category?: RequestCategory;

  /** Inclusive start date, `YYYY-MM-DD` (UTC). */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /** Inclusive end date, `YYYY-MM-DD` (UTC). */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class ChangeStatusDto {
  @IsEnum(RequestStatus)
  status: RequestStatus;
}

export class RequestPage {
  items: ServiceRequest[];
  total: number;
  page: number;
  pageSize: number;
}

export class RequestDetails extends ServiceRequest {
  /** Every status change, oldest first. */
  history: StatusHistory[];
}
