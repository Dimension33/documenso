import type { TRecipientActionAuth } from '@documenso/lib/types/document-auth';
import { ZFieldMetaSchema } from '@documenso/lib/types/field-meta';
import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
import { FieldRootContainer } from '@documenso/ui/components/field/field';
import { getRecipientColorStyles } from '@documenso/ui/lib/recipient-colors';
import { cn } from '@documenso/ui/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@documenso/ui/primitives/tooltip';
import { Trans } from '@lingui/react/macro';
import { FieldType } from '@prisma/client';
import { TooltipArrow } from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import type React from 'react';

import { useRequiredDocumentSigningAuthContext } from './document-signing-auth-provider';

export type DocumentSigningFieldContainerProps = {
  field: FieldWithSignature;
  loading?: boolean;
  children: React.ReactNode;

  /**
   * A function that is called before the field requires to be signed, or reauthed.
   *
   * Example, you may want to show a dialog prior to signing where they can enter a value.
   *
   * Once that action is complete, you will need to call `executeActionAuthProcedure` to proceed
   * regardless if it requires reauth or not.
   *
   * If the function returns true, we will proceed with the signing process. Otherwise if
   * false is returned we will not proceed.
   */
  onPreSign?: () => Promise<boolean> | boolean;

  /**
   * The function required to be executed to insert the field.
   *
   * The auth values will be passed in if available.
   */
  onSign?: (documentAuthValue?: TRecipientActionAuth) => Promise<void> | void;
  onRemove?: (fieldType?: string) => Promise<void> | void;
  type?: 'Date' | 'Initials' | 'Email' | 'Name' | 'Signature' | 'Text' | 'Radio' | 'Dropdown' | 'Number' | 'Checkbox';
  tooltipText?: string | null;
};

export const DocumentSigningFieldContainer = ({
  field,
  loading,
  onPreSign,
  onSign,
  onRemove,
  children,
  type,
  tooltipText,
}: DocumentSigningFieldContainerProps) => {
  const { executeActionAuthProcedure, isAuthRedirectRequired } = useRequiredDocumentSigningAuthContext();

  const parsedFieldMeta = field.fieldMeta ? ZFieldMetaSchema.parse(field.fieldMeta) : undefined;
  const readOnlyField = parsedFieldMeta?.readOnly || false;

  /**
   * D2DHQ fork: after a field is signed, jump the viewport to the next
   * uninserted field so the signer doesn't have to scroll-hunt on mobile.
   *
   * We can't read field state directly from this container (it only sees
   * its own field), so we DOM-query the next `[data-inserted="false"]`
   * after the current one in document order. queueMicrotask defers until
   * after React commits the new state so the just-signed field has flipped
   * to `data-inserted="true"`.
   */
  const scrollToNextUninsertedField = () => {
    queueMicrotask(() => {
      try {
        const currentEl = document.getElementById(`field-${field.id}`);
        if (!currentEl) return;
        const allFields = Array.from(document.querySelectorAll('[id^="field-"][data-inserted]'));
        const currentIdx = allFields.indexOf(currentEl);
        if (currentIdx === -1) return;
        const next = allFields
          .slice(currentIdx + 1)
          .find((el) => el.getAttribute('data-inserted') === 'false' && el.getAttribute('data-readonly') !== 'true');
        if (next) {
          next.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } catch {
        // Best-effort — never let an autoscroll bug block signing.
      }
    });
  };

  const handleInsertField = async () => {
    if (field.inserted || !onSign) {
      return;
    }

    // Bypass reauth for non signature fields.
    if (field.type !== FieldType.SIGNATURE) {
      const presignResult = await onPreSign?.();

      if (presignResult === false) {
        return;
      }

      await onSign();
      scrollToNextUninsertedField();
      return;
    }

    if (isAuthRedirectRequired) {
      await executeActionAuthProcedure({
        onReauthFormSubmit: () => {
          // Do nothing since the user should be redirected.
        },
        actionTarget: field.type,
      });

      return;
    }

    // Handle any presign requirements, and halt if required.
    if (onPreSign) {
      const preSignResult = await onPreSign();

      if (preSignResult === false) {
        return;
      }
    }

    await executeActionAuthProcedure({
      onReauthFormSubmit: onSign,
      actionTarget: field.type,
    });
    scrollToNextUninsertedField();
  };

  const onRemoveSignedFieldClick = async () => {
    if (!field.inserted) {
      return;
    }

    await onRemove?.();
  };

  const onClearCheckBoxValues = async (fieldType?: string) => {
    if (!field.inserted) {
      return;
    }

    await onRemove?.(fieldType);
  };

  return (
    <FieldRootContainer color={getRecipientColorStyles(field.fieldMeta?.readOnly ? 'readOnly' : 0)} field={field}>
      {!field.inserted && !loading && !readOnlyField && (
        <button
          type="submit"
          className="absolute inset-0 z-10 h-full w-full rounded-[2px]"
          onClick={async () => handleInsertField()}
        />
      )}

      {type === 'Checkbox' && field.inserted && !loading && !readOnlyField && (
        <button
          className="absolute -bottom-10 flex items-center justify-evenly rounded-md border bg-gray-900 opacity-0 group-hover:opacity-100"
          onClick={() => void onClearCheckBoxValues(type)}
        >
          <span className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100">
            <X className="h-4 w-4" />
          </span>
        </button>
      )}

      {type !== 'Checkbox' && field.inserted && !loading && !readOnlyField && (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button className="absolute inset-0 z-10" onClick={onRemoveSignedFieldClick}></button>
          </TooltipTrigger>

          <TooltipContent className="border-0 bg-orange-300 fill-orange-300 text-orange-900" sideOffset={2}>
            {tooltipText && <p>{tooltipText}</p>}

            <Trans>Remove</Trans>
            <TooltipArrow />
          </TooltipContent>
        </Tooltip>
      )}

      {(field.type === FieldType.RADIO || field.type === FieldType.CHECKBOX) && field.fieldMeta?.label && (
        <div
          className={cn(
            'absolute -top-16 right-0 left-0 rounded-md p-2 text-center text-gray-700 text-xs',
            {
              'border border-border bg-foreground/5': !field.inserted,
            },
            {
              'border border-primary bg-documenso-200': field.inserted,
            },
          )}
        >
          {field.fieldMeta.label}
        </div>
      )}

      {children}
    </FieldRootContainer>
  );
};
