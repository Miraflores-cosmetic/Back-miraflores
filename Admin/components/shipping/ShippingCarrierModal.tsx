'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  AddressMap,
  type AddressMapResult,
} from '@/components/AddressMap/AddressMap';
import { FloatingTextField } from '@/components/FloatingTextField/FloatingTextField';
import { PhoneField } from '@/components/PhoneField/PhoneField';
import { PrimaryBtn } from '@/components/PrimaryBtn/PrimaryBtn';
import { useBuyerAuthOptional } from '@/lib/BuyerAuthProvider';
import { trapFocusKeydown } from '@/lib/focusTrap';
import { formatPhoneE164, isValidPhone } from '@/lib/phone';
import type {
  JcosShippingCarrier,
  JcosShippingDropoff,
} from '@/lib/shipping/addressShippingMeta';
import { yandexPointIdForCargoOffers } from '@/lib/shipping/yandexPickupPointId';
import type { YandexPickupPoint } from '@/lib/shipping/types';
import { CdekPvzPicker, type CdekPvzChoice } from './CdekPvzPicker';
import { YandexPvzPicker } from './YandexPvzPicker';
import panelStyles from './SideDrawerPanel.module.css';
import styles from './ShippingCarrierModal.module.css';

export type ShippingSelection = {
  carrier: JcosShippingCarrier;
  dropoff: JcosShippingDropoff;
  recipientName: string;
  phone: string;
  city: string;
  address: string;
  apartment: string;
  postalCode: string;
  comment: string;
  /** Область / край с карты или ПВЗ */
  region?: string;
  /** Район (если известен) */
  district?: string;
  lat?: number;
  lon?: number;
  pvzId?: string;
  /** Подсказка стоимости доставки (руб.), если уже посчитана снаружи */
  shippingCostHint?: number;
};

type Seed = Partial<
  Pick<
    ShippingSelection,
    | 'recipientName'
    | 'phone'
    | 'city'
    | 'address'
    | 'apartment'
    | 'postalCode'
    | 'comment'
    | 'region'
    | 'district'
    | 'carrier'
    | 'dropoff'
    | 'lat'
    | 'lon'
    | 'pvzId'
  >
>;

type Props = {
  open: boolean;
  seed?: Seed | null;
  /** Имя/телефон из профиля ЛК — если в seed пусто */
  profileDefaults?: { recipientName?: string; phone?: string } | null;
  onClose: () => void;
  onConfirm: (selection: ShippingSelection) => void;
  /**
   * После onConfirm закрывать модалку (default true).
   * Админка: false — родитель держит open и показывает шаг «стоимость».
   */
  closeAfterConfirm?: boolean;
};

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M15 5L5 15M5 5l10 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type FieldKey =
  | 'recipientName'
  | 'phone'
  | 'city'
  | 'address'
  | 'apartment'
  | 'postalCode';

export function ShippingCarrierModal({
  open,
  seed,
  profileDefaults = null,
  onClose,
  onConfirm,
  closeAfterConfirm = true,
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const buyerAuth = useBuyerAuthOptional();
  const buyerUser = buyerAuth?.user ?? null;
  const seedRef = useRef(seed);
  const profileRef = useRef(profileDefaults);
  seedRef.current = seed;
  profileRef.current = profileDefaults;

  const [carrier, setCarrier] = useState<JcosShippingCarrier>('cdek');
  const [dropoff, setDropoff] = useState<JcosShippingDropoff>('pvz');
  const [recipientName, setRecipientName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [apartment, setApartment] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [region, setRegion] = useState('');
  const [district, setDistrict] = useState('');
  const [comment, setComment] = useState('');
  const [lat, setLat] = useState<number | undefined>();
  const [lon, setLon] = useState<number | undefined>();
  const [pvzId, setPvzId] = useState<string | undefined>();
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const s = seedRef.current;
    const profile = profileRef.current;
    setCarrier(s?.carrier ?? 'cdek');
    setDropoff(s?.dropoff ?? 'pvz');
    setRecipientName(
      s?.recipientName?.trim() || profile?.recipientName?.trim() || '',
    );
    setPhone(s?.phone?.trim() || profile?.phone?.trim() || '');
    setCity(s?.city?.trim() || '');
    setAddress(s?.address?.trim() || '');
    setApartment(s?.apartment?.trim() || '');
    setPostalCode(s?.postalCode?.trim() || '');
    setRegion(s?.region?.trim() || '');
    setDistrict(s?.district?.trim() || '');
    setComment(s?.comment?.trim() || '');
    setLat(s?.lat);
    setLon(s?.lon);
    setPvzId(s?.pvzId);
    setErrors({});
    setFormError(null);
    setSubmitting(false);

    const needName = !(
      s?.recipientName?.trim() || profile?.recipientName?.trim()
    );
    const needPhone = !(s?.phone?.trim() || profile?.phone?.trim());
    if (!needName && !needPhone) return;
    if (!buyerUser) return;
    if (needName && buyerUser.displayName?.trim()) {
      setRecipientName((prev) => prev || buyerUser.displayName!.trim());
    }
    if (needPhone && buyerUser.phone?.trim()) {
      setPhone((prev) => prev || buyerUser.phone!.trim());
    }
  }, [open, buyerUser]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const closeBtn = panel?.querySelector<HTMLElement>(
      `.${panelStyles.closeBtn}`,
    );
    (closeBtn ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (panel) trapFocusKeydown(e, panel);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  function clearFieldError(key: FieldKey) {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleCdekPvz(pvz: CdekPvzChoice) {
    setDropoff('pvz');
    setPvzId(pvz.id);
    setCity(pvz.cityName || city);
    setAddress(pvz.address || address);
    setPostalCode(pvz.postalCode || postalCode);
    if (pvz.region?.trim()) setRegion(pvz.region.trim());
    if (
      pvz.lat != null &&
      pvz.lon != null &&
      Number.isFinite(pvz.lat) &&
      Number.isFinite(pvz.lon)
    ) {
      setLat(pvz.lat);
      setLon(pvz.lon);
    } else {
      setLat(undefined);
      setLon(undefined);
    }
    clearFieldError('city');
    clearFieldError('address');
  }

  function handleYandexPvz(pvz: YandexPickupPoint) {
    setDropoff('pvz');
    const cityName =
      pvz.address?.locality || pvz.address?.region || city;
    setCity(cityName);
    setAddress(pvz.address?.full_address || address);
    setPostalCode(pvz.address?.postal_code || postalCode);
    if (pvz.address?.region?.trim()) setRegion(pvz.address.region.trim());
    const cargoId = yandexPointIdForCargoOffers(pvz);
    setPvzId(cargoId || pvz.id);
    if (
      pvz.position &&
      Number.isFinite(pvz.position.longitude) &&
      Number.isFinite(pvz.position.latitude)
    ) {
      setLon(pvz.position.longitude);
      setLat(pvz.position.latitude);
    } else {
      setLat(undefined);
      setLon(undefined);
    }
    clearFieldError('city');
    clearFieldError('address');
  }

  function handleCourierMap(result: AddressMapResult) {
    setDropoff('courier');
    setPvzId(undefined);
    setLat(result.lat);
    setLon(result.lon);
    const street = result.addressLine
      .replace(new RegExp(`^${result.city}\\s*,?\\s*`, 'i'), '')
      .replace(/,\s*\d{6}\s*$/, '')
      .trim();
    setCity(result.city?.trim() || city);
    setAddress(street || result.addressLine || address);
    setPostalCode(result.postalCode?.trim() || postalCode);
    if (result.region?.trim()) setRegion(result.region.trim());
    clearFieldError('city');
    clearFieldError('address');
  }

  function switchCarrier(next: JcosShippingCarrier) {
    setCarrier(next);
    setPvzId(undefined);
    setLat(undefined);
    setLon(undefined);
  }

  function switchDropoff(next: JcosShippingDropoff) {
    setDropoff(next);
    if (next === 'courier') {
      setPvzId(undefined);
    } else {
      setLat(undefined);
      setLon(undefined);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: Partial<Record<FieldKey, string>> = {};
    if (!city.trim()) next.city = 'Укажите город';
    if (!address.trim()) next.address = 'Укажите адрес';
    const phoneRaw = phone.trim();
    if (phoneRaw && !isValidPhone(phoneRaw)) {
      next.phone = 'Введите номер: +7 (9XX) XXX-XX-XX';
    }
    if (dropoff === 'pvz' && !pvzId?.trim()) {
      setFormError('Выберите пункт выдачи');
      setErrors(next);
      return;
    }
    if (
      dropoff === 'courier' &&
      (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon))
    ) {
      setFormError('Укажите точку на карте');
      setErrors(next);
      return;
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    onConfirm({
      carrier,
      dropoff,
      recipientName: recipientName.trim(),
      phone: phoneRaw ? formatPhoneE164(phoneRaw) : '',
      city: city.trim(),
      address: address.trim(),
      apartment: apartment.trim(),
      postalCode: postalCode.trim(),
      comment: comment.trim(),
      ...(region.trim() ? { region: region.trim() } : {}),
      ...(district.trim() ? { district: district.trim() } : {}),
      ...(lat != null && Number.isFinite(lat) ? { lat } : {}),
      ...(lon != null && Number.isFinite(lon) ? { lon } : {}),
      ...(dropoff === 'pvz' && pvzId?.trim() ? { pvzId: pvzId.trim() } : {}),
    });
    setSubmitting(false);
    if (closeAfterConfirm) onClose();
  }

  const selectedSummary =
    city.trim() && address.trim()
      ? [
          carrier === 'yandex' ? 'Яндекс' : 'СДЭК',
          dropoff === 'pvz' ? 'ПВЗ' : 'Курьер',
          city.trim(),
          address.trim(),
        ].join(' · ')
      : null;

  return (
    <>
      <button
        type="button"
        className={panelStyles.backdrop}
        aria-label="Закрыть"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className={panelStyles.panel}
        style={{ width: 'min(1200px, 100vw)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={panelStyles.header}>
          <h2 id={titleId} className={panelStyles.title}>
            Доставка
          </h2>
          <button
            type="button"
            className={panelStyles.closeBtn}
            aria-label="Закрыть"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <form
          className={panelStyles.form}
          noValidate
          onSubmit={(e) => void onSubmit(e)}
        >
          <div className={panelStyles.body}>
            <div className={panelStyles.row2}>
              <FloatingTextField
                label="Имя получателя"
                value={recipientName}
                onChange={(e) => {
                  setRecipientName(e.target.value);
                  clearFieldError('recipientName');
                }}
                autoComplete="name"
              />
              <PhoneField
                label="Телефон"
                value={phone}
                onChange={(v) => {
                  setPhone(v);
                  clearFieldError('phone');
                }}
                error={errors.phone}
              />
            </div>

            <div className={styles.block}>
              <div>
                <h3 className={styles.blockTitle}>Способ доставки</h3>
                <p className={styles.blockHint}>
                  Перевозчик, затем пункт выдачи или курьер до двери
                </p>
              </div>

              <div className={styles.tabs} role="tablist" aria-label="Перевозчик">
                <button
                  type="button"
                  role="tab"
                  aria-selected={carrier === 'cdek'}
                  className={[
                    styles.tab,
                    carrier === 'cdek' ? styles.tabActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => switchCarrier('cdek')}
                >
                  СДЭК
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={carrier === 'yandex'}
                  className={[
                    styles.tab,
                    carrier === 'yandex' ? styles.tabActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => switchCarrier('yandex')}
                >
                  Яндекс
                </button>
              </div>

              <div
                className={styles.tabs}
                role="tablist"
                aria-label="Тип доставки"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={dropoff === 'pvz'}
                  className={[
                    styles.tab,
                    dropoff === 'pvz' ? styles.tabActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => switchDropoff('pvz')}
                >
                  Пункт выдачи
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={dropoff === 'courier'}
                  className={[
                    styles.tab,
                    dropoff === 'courier' ? styles.tabActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => switchDropoff('courier')}
                >
                  Курьером
                </button>
              </div>

              <div className={styles.pickerFrame}>
                {carrier === 'cdek' && dropoff === 'pvz' ? (
                  <CdekPvzPicker
                    onChoose={handleCdekPvz}
                    defaultCity={city || 'Москва'}
                    selectedPvzId={pvzId ?? null}
                  />
                ) : null}
                {carrier === 'yandex' && dropoff === 'pvz' ? (
                  <YandexPvzPicker
                    onChoose={handleYandexPvz}
                    defaultCity={city || 'Москва'}
                    selectedPointId={pvzId ?? null}
                  />
                ) : null}
                {dropoff === 'courier' ? (
                  <AddressMap
                    eager
                    hintCity={city.trim() || 'Москва'}
                    onSelect={handleCourierMap}
                  />
                ) : null}
              </div>

              {selectedSummary ? (
                <p className={styles.selectedHint}>{selectedSummary}</p>
              ) : null}
            </div>

            <FloatingTextField
              label="Город"
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                clearFieldError('city');
              }}
              autoComplete="address-level2"
              required
              error={errors.city}
            />
            <FloatingTextField
              label="Адрес"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                clearFieldError('address');
              }}
              autoComplete="street-address"
              required
              error={errors.address}
            />
            <div className={panelStyles.row2}>
              <FloatingTextField
                label="Квартира / офис"
                value={apartment}
                onChange={(e) => setApartment(e.target.value)}
                autoComplete="address-line2"
              />
              <FloatingTextField
                label="Индекс"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                autoComplete="postal-code"
              />
            </div>
            <FloatingTextField
              label="Комментарий"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />

            {formError ? (
              <p className={panelStyles.error} role="alert">
                {formError}
              </p>
            ) : null}
          </div>

          <div className={panelStyles.footer}>
            <PrimaryBtn type="submit" disabled={submitting}>
              {submitting ? 'Сохранение…' : 'Подтвердить'}
            </PrimaryBtn>
          </div>
        </form>
      </aside>
    </>
  );
}
