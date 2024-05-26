import { zodResolver } from "@hookform/resolvers/zod";
import type { TEventType, TEventTypeGroup, TEventTypesForm } from "@pages/apps/installation/[[...step]]";
import { X } from "lucide-react";
import type { Dispatch, SetStateAction, FC } from "react";
import React, { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UseFormGetValues, UseFormSetValue, Control, FormState } from "react-hook-form";
import { useFieldArray, useFormContext } from "react-hook-form";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { EventTypeAppSettings } from "@calcom/app-store/_components/EventTypeAppSettingsInterface";
import { type EventTypeAppsList } from "@calcom/app-store/utils";
import type { LocationObject } from "@calcom/core/location";
import type { LocationFormValues } from "@calcom/features/eventtypes/lib/types";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { AppCategories } from "@calcom/prisma/enums";
import type { EventTypeMetaDataSchema, eventTypeBookingFields } from "@calcom/prisma/zod-utils";
import { Button, Form, Skeleton, Label, Avatar } from "@calcom/ui";

import useAppsData from "@lib/hooks/useAppsData";

import Locations from "@components/eventtype/Locations";
import type { TEventTypeLocation } from "@components/eventtype/Locations";
import type { SingleValueLocationOption } from "@components/ui/form/LocationSelect";

import { locationsResolver } from "~/event-types/views/event-types-single-view";

export type TFormType = {
  id: number;
  metadata: z.infer<typeof EventTypeMetaDataSchema>;
  locations: LocationObject[];
  bookingFields: z.infer<typeof eventTypeBookingFields>;
};

type ConfigureStepCardProps = {
  slug: string;
  userName: string;
  categories: AppCategories[];
  credentialId?: number;
  loading?: boolean;
  isConferencing: boolean;
  formPortalRef: React.RefObject<HTMLDivElement>;
  eventTypeGroups: TEventTypeGroup[];
  setConfigureStep: Dispatch<SetStateAction<boolean>>;
  handleSetUpLater: () => void;
};

type EventTypeAppSettingsFormProps = Pick<
  ConfigureStepCardProps,
  "slug" | "userName" | "categories" | "credentialId" | "loading" | "isConferencing"
> & {
  eventType: TEventType;
  handleDelete: () => void;
  onSubmit: ({
    locations,
    bookingFields,
    metadata,
  }: {
    metadata?: z.infer<typeof EventTypeMetaDataSchema>;
    bookingFields?: z.infer<typeof eventTypeBookingFields>;
    locations?: LocationObject[];
  }) => void;
};

type EventTypeAppSettingsWrapperProps = Pick<
  ConfigureStepCardProps,
  "slug" | "userName" | "categories" | "credentialId"
> & {
  eventType: TEventType;
};

type TUpdatedEventTypesStatus = { id: number; updated: boolean }[][];

const EventTypeAppSettingsWrapper: FC<EventTypeAppSettingsWrapperProps> = ({
  slug,
  eventType,
  categories,
  credentialId,
}) => {
  const { getAppDataGetter, getAppDataSetter } = useAppsData();

  useEffect(() => {
    const appDataSetter = getAppDataSetter(slug as EventTypeAppsList, categories, credentialId);
    appDataSetter("enabled", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <EventTypeAppSettings
      slug={slug}
      eventType={eventType}
      getAppData={getAppDataGetter(slug as EventTypeAppsList)}
      setAppData={getAppDataSetter(slug as EventTypeAppsList, categories, credentialId)}
    />
  );
};

const EventTypeConferencingAppSettings = ({ eventType, slug }: { eventType: TEventType; slug: string }) => {
  const { t } = useLocale();
  const formMethods = useFormContext<TFormType>();

  const prefillLocation = useMemo(() => {
    let res: SingleValueLocationOption | undefined = undefined;
    for (const item of eventType?.locationOptions || []) {
      for (const option of item.options) {
        if (option.slug === slug) {
          res = {
            ...option,
          };
        }
      }
      return res;
    }
  }, [slug, eventType?.locationOptions]);

  return (
    <div className="mt-2">
      <Skeleton as={Label} loadingClassName="w-16" htmlFor="locations">
        {t("location")}
      </Skeleton>
      <Locations
        showAppStoreLink={false}
        isChildrenManagedEventType={false}
        isManagedEventType={false}
        disableLocationProp={false}
        eventType={eventType as TEventTypeLocation}
        destinationCalendar={eventType.destinationCalendar}
        locationOptions={eventType.locationOptions || []}
        prefillLocation={prefillLocation}
        team={null}
        getValues={formMethods.getValues as unknown as UseFormGetValues<LocationFormValues>}
        setValue={formMethods.setValue as unknown as UseFormSetValue<LocationFormValues>}
        control={formMethods.control as unknown as Control<LocationFormValues>}
        formState={formMethods.formState as unknown as FormState<LocationFormValues>}
      />
    </div>
  );
};

const EventTypeAppSettingsForm = forwardRef<HTMLButtonElement, EventTypeAppSettingsFormProps>(
  function EventTypeAppSettingsForm(props, ref) {
    const { handleDelete, onSubmit, eventType, loading, isConferencing } = props;
    const { t } = useLocale();

    const formMethods = useForm<TFormType>({
      defaultValues: {
        id: eventType.id,
        metadata: eventType?.metadata,
        locations: eventType?.locations,
        bookingFields: eventType?.bookingFields,
      },
      resolver: zodResolver(
        z.object({
          locations: locationsResolver(t),
        })
      ),
    });

    return (
      <Form
        form={formMethods}
        id={`eventtype-${eventType.id}`}
        handleSubmit={(e) => {
          const metadata = formMethods.getValues("metadata");
          const locations = formMethods.getValues("locations");
          const bookingFields = formMethods.getValues("bookingFields");
          onSubmit({ metadata, locations, bookingFields });
        }}>
        <div>
          <div className="sm:border-subtle bg-default relative border p-4 dark:bg-black sm:rounded-md">
            <div>
              <span className="text-default font-semibold ltr:mr-1 rtl:ml-1">{eventType.title}</span>{" "}
              <small className="text-subtle hidden font-normal sm:inline">
                /{eventType.team ? eventType.team.slug : props.userName}/{eventType.slug}
              </small>
            </div>
            {isConferencing ? (
              <EventTypeConferencingAppSettings {...props} />
            ) : (
              <EventTypeAppSettingsWrapper {...props} />
            )}
            <X
              data-testid={`remove-event-type-${eventType.id}`}
              className="absolute right-4 top-4 h-4 w-4 cursor-pointer"
              onClick={() => !loading && handleDelete()}
            />
            <button type="submit" className="hidden" form={`eventtype-${eventType.id}`} ref={ref}>
              Save
            </button>
          </div>
        </div>
      </Form>
    );
  }
);

const EventTypeGroup = ({
  groupIndex,
  eventTypeGroups,
  setUpdatedEventTypesStatus,
  submitRefs,
  ...props
}: ConfigureStepCardProps & {
  groupIndex: number;
  setUpdatedEventTypesStatus: Dispatch<SetStateAction<TUpdatedEventTypesStatus>>;
  submitRefs: Array<React.RefObject<HTMLButtonElement>>;
}) => {
  const { control } = useFormContext<TEventTypesForm>();
  const { fields, update } = useFieldArray({
    control,
    name: `eventTypeGroups.${groupIndex}.eventTypes`,
    keyName: "fieldId",
  });

  return (
    <div className="ml-2 flex flex-col space-y-6">
      {fields.map(
        (field, index) =>
          field.selected && (
            <EventTypeAppSettingsForm
              key={field.fieldId}
              eventType={field}
              loading={props.loading}
              handleDelete={() => {
                const eventTypeDb = eventTypeGroups[groupIndex].eventTypes?.find(
                  (eventType) => eventType.id == field.id
                );
                update(index, {
                  ...field,
                  selected: false,
                  metadata: eventTypeDb?.metadata,
                  bookingFields: eventTypeDb?.bookingFields,
                  ...(eventTypeDb?.locations && { locations: eventTypeDb.locations }),
                });

                setUpdatedEventTypesStatus((prev) => {
                  const res = [...prev];
                  res[groupIndex] = res[groupIndex].filter((item) => !(item.id === field.id));
                  if (!res.some((item) => item.length > 0)) {
                    props.setConfigureStep(false);
                  }
                  return res;
                });
              }}
              onSubmit={(data) => {
                update(index, { ...field, ...data });
                setUpdatedEventTypesStatus((prev) => {
                  const res = [...prev];
                  res[groupIndex] = res[groupIndex].map((item) =>
                    item.id === field.id ? { ...item, updated: true } : item
                  );
                  return res;
                });
              }}
              ref={submitRefs[index]}
              {...props}
            />
          )
      )}
    </div>
  );
};

export const ConfigureStepCard: FC<ConfigureStepCardProps> = (props) => {
  const { loading, formPortalRef, handleSetUpLater } = props;
  const { t } = useLocale();
  const { control, watch } = useFormContext<TEventTypesForm>();
  const { fields } = useFieldArray({
    control,
    name: "eventTypeGroups",
    keyName: "fieldId",
  });
  const eventTypeGroups = watch("eventTypeGroups");

  const submitRefs = useRef<Array<Array<React.RefObject<HTMLButtonElement>>>>([]);

  submitRefs.current = eventTypeGroups.reduce(
    (arr: Array<Array<React.RefObject<HTMLButtonElement>>>, field) => {
      const res = field.eventTypes
        .filter((eventType) => eventType.selected)
        .map((_ref) => React.createRef<HTMLButtonElement>());
      return [...arr, res];
    },
    []
  );

  const mainForSubmitRef = useRef<HTMLButtonElement>(null);

  const [updatedEventTypesStatus, setUpdatedEventTypesStatus] = useState<TUpdatedEventTypesStatus>(
    eventTypeGroups.reduce((arr: Array<{ id: number; updated: boolean }[]>, field) => {
      const selectedEventTypes = field.eventTypes
        .filter((eventType) => eventType.selected)
        .map((eventType) => ({ id: eventType.id as number, updated: false }));

      return [...arr, selectedEventTypes];
    }, [])
  );

  const [submit, setSubmit] = useState(false);
  const allUpdated = updatedEventTypesStatus.every((item) => item.every((iitem) => iitem.updated));

  useEffect(() => {
    if (submit && allUpdated && mainForSubmitRef.current) {
      mainForSubmitRef.current?.click();
      setSubmit(false);
    }
  }, [submit, allUpdated, mainForSubmitRef]);

  return (
    formPortalRef?.current &&
    createPortal(
      <div className="mt-8">
        {fields.map((group, groupIndex) => (
          <div key={group.fieldId}>
            {eventTypeGroups[groupIndex].eventTypes.some((eventType) => eventType.selected === true) && (
              <div className="mb-2 flex items-center">
                <Avatar
                  alt=""
                  imageSrc={group.image} // if no image, use default avatar
                  size="md"
                  className="mt-1 inline-flex justify-center"
                />
                <p className="text-subtle block">{group.slug}</p>
              </div>
            )}
            <EventTypeGroup
              groupIndex={groupIndex}
              setUpdatedEventTypesStatus={setUpdatedEventTypesStatus}
              submitRefs={submitRefs.current[groupIndex]}
              {...props}
            />
          </div>
        ))}
        <button form="outer-event-type-form" type="submit" className="hidden" ref={mainForSubmitRef}>
          Save
        </button>
        <Button
          className="text-md mt-6 w-full justify-center"
          type="button"
          data-testid="configure-step-save"
          onClick={() => {
            submitRefs.current[0][0].current?.click();
            submitRefs.current.map((group) => group?.map((ref) => ref.current?.click()));
            setSubmit(true);
          }}
          loading={loading}>
          {t("save")}
        </Button>

        <div className="flex w-full flex-row justify-center">
          <Button
            color="minimal"
            data-testid="set-up-later"
            onClick={(event) => {
              event.preventDefault();
              handleSetUpLater();
            }}
            className="mt-8 cursor-pointer px-4 py-2 font-sans text-sm font-medium">
            {t("set_up_later")}
          </Button>
        </div>
      </div>,
      formPortalRef?.current
    )
  );
};
